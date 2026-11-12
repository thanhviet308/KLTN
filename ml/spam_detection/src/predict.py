from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "artifacts" / "best_spam_model.joblib"
METADATA_PATH = ROOT / "artifacts" / "model_metadata.json"


def predict(message: str) -> dict[str, object]:
    text = message.strip()
    if not text:
        raise ValueError("Tin nhắn không được để trống")
    if not MODEL_PATH.exists():
        raise FileNotFoundError("Chưa có mô hình. Hãy chạy src/train.py trước")

    model = joblib.load(MODEL_PATH)
    label = int(model.predict([text])[0])
    if hasattr(model, "predict_proba"):
        score = float(model.predict_proba([text])[0, 1])
    else:
        decision = float(model.decision_function([text])[0])
        score = float(1.0 / (1.0 + np.exp(-np.clip(decision, -30, 30))))
    metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    return {
        "label": label,
        "label_name": "spam_or_scam" if label == 1 else "normal",
        "risk_score": round(score, 6),
        "model": metadata["best_model"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Dự đoán tin nhắn spam/lừa đảo")
    parser.add_argument("message", help="Nội dung tin nhắn cần kiểm tra")
    args = parser.parse_args()
    print(json.dumps(predict(args.message), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
