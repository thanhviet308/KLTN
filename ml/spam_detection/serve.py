from __future__ import annotations

import argparse
import json
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import joblib
import numpy as np

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
MODEL_PATH = ROOT / "artifacts" / "best_spam_model.joblib"
METADATA_PATH = ROOT / "artifacts" / "model_metadata.json"


class DashboardHandler(SimpleHTTPRequestHandler):
    model = None
    model_name = "unknown"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def send_json(self, status: int, value: dict[str, object]) -> None:
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self.send_json(200, {"status": "ok", "model": self.model_name})
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path != "/api/predict":
            self.send_json(404, {"error": "NOT_FOUND"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 40_000:
                raise ValueError("INVALID_LENGTH")
            value = json.loads(self.rfile.read(length).decode("utf-8"))
            message = value.get("message") if isinstance(value, dict) else None
            if not isinstance(message, str) or not message.strip() or len(message) > 10_000:
                raise ValueError("INVALID_MESSAGE")
            label = int(self.model.predict([message.strip()])[0])
            if hasattr(self.model, "predict_proba"):
                score = float(self.model.predict_proba([message.strip()])[0, 1])
            else:
                decision = float(self.model.decision_function([message.strip()])[0])
                score = float(1.0 / (1.0 + np.exp(-np.clip(decision, -30, 30))))
            self.send_json(
                200,
                {"label": label, "risk_score": round(score, 6), "model": self.model_name},
            )
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "INVALID_REQUEST"})
        except Exception:
            self.send_json(500, {"error": "PREDICTION_FAILED"})


def main() -> None:
    parser = argparse.ArgumentParser(description="Chạy dashboard ML độc lập")
    parser.add_argument("--port", type=int, default=8501)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if not MODEL_PATH.exists() or not METADATA_PATH.exists():
        raise FileNotFoundError("Model not found. Run src/train.py first.")
    DashboardHandler.model = joblib.load(MODEL_PATH)
    DashboardHandler.model_name = json.loads(
        METADATA_PATH.read_text(encoding="utf-8")
    )["best_model"]
    server = ThreadingHTTPServer(("127.0.0.1", args.port), DashboardHandler)
    url = f"http://127.0.0.1:{args.port}"
    print(f"ML dashboard: {url}")
    print("Press Ctrl+C to stop.")
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDashboard stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
