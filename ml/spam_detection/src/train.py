from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / ".matplotlib"))

import joblib
import matplotlib
import numpy as np
import pandas as pd
from matplotlib import pyplot as plt
import seaborn as sns
from sklearn.base import clone
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, SGDClassifier
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import ComplementNB
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

matplotlib.use("Agg")

RANDOM_STATE = 42
DATA_PATH = ROOT / "data" / "full_dataset.csv"
ARTIFACTS_DIR = ROOT / "artifacts"
REPORTS_DIR = ROOT / "reports"
WEB_DATA_DIR = ROOT / "web" / "data"


def load_dataset(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    required = {"message", "label"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"CSV thiếu cột bắt buộc: {', '.join(sorted(missing))}")

    clean = frame.copy()
    clean["message"] = clean["message"].fillna("").astype(str).str.strip()
    clean["label"] = pd.to_numeric(clean["label"], errors="coerce")
    clean = clean[clean["message"].ne("") & clean["label"].isin([0, 1])]
    clean["label"] = clean["label"].astype(int)
    clean = clean.drop_duplicates(subset=["message", "label"]).reset_index(drop=True)
    if clean["label"].nunique() != 2:
        raise ValueError("Dữ liệu phải có đủ hai nhãn 0 và 1")
    return clean


def split_dataset(frame: pd.DataFrame):
    train, remainder = train_test_split(
        frame,
        test_size=0.30,
        stratify=frame["label"],
        random_state=RANDOM_STATE,
    )
    validation, test = train_test_split(
        remainder,
        test_size=0.50,
        stratify=remainder["label"],
        random_state=RANDOM_STATE,
    )
    return train.reset_index(drop=True), validation.reset_index(drop=True), test.reset_index(drop=True)


def make_pipeline(classifier) -> Pipeline:
    return Pipeline(
        [
            (
                "tfidf",
                TfidfVectorizer(
                    lowercase=True,
                    strip_accents="unicode",
                    analyzer="char_wb",
                    ngram_range=(3, 5),
                    min_df=2,
                    max_features=40_000,
                    sublinear_tf=True,
                ),
            ),
            ("classifier", classifier),
        ]
    )


def build_models() -> dict[str, Pipeline]:
    return {
        "Complement Naive Bayes": make_pipeline(ComplementNB(alpha=0.5)),
        "Logistic Regression": make_pipeline(
            LogisticRegression(max_iter=2_000, class_weight="balanced", random_state=RANDOM_STATE)
        ),
        "Linear SVM": make_pipeline(LinearSVC(class_weight="balanced", random_state=RANDOM_STATE)),
        "SGD Classifier": make_pipeline(
            SGDClassifier(
                loss="modified_huber",
                class_weight="balanced",
                max_iter=2_000,
                random_state=RANDOM_STATE,
            )
        ),
        "Random Forest": make_pipeline(
            RandomForestClassifier(
                n_estimators=250,
                class_weight="balanced_subsample",
                n_jobs=1,
                random_state=RANDOM_STATE,
            )
        ),
    }


def risk_scores(model: Pipeline, messages: pd.Series) -> np.ndarray:
    if hasattr(model, "predict_proba"):
        return model.predict_proba(messages)[:, 1]
    decision = model.decision_function(messages)
    return 1.0 / (1.0 + np.exp(-np.clip(decision, -30, 30)))


def metrics_for(model: Pipeline, messages: pd.Series, labels: pd.Series) -> dict[str, float]:
    predicted = model.predict(messages)
    scores = risk_scores(model, messages)
    return {
        "accuracy": accuracy_score(labels, predicted),
        "precision": precision_score(labels, predicted, zero_division=0),
        "recall": recall_score(labels, predicted, zero_division=0),
        "f1": f1_score(labels, predicted, zero_division=0),
        "roc_auc": roc_auc_score(labels, scores),
    }


def save_split_summary(splits: dict[str, pd.DataFrame]) -> pd.DataFrame:
    rows = []
    for name, split in splits.items():
        counts = split["label"].value_counts()
        rows.append(
            {
                "split": name,
                "total": len(split),
                "normal": int(counts.get(0, 0)),
                "spam": int(counts.get(1, 0)),
                "spam_rate": float(split["label"].mean()),
            }
        )
    result = pd.DataFrame(rows)
    result.to_csv(REPORTS_DIR / "data_split_summary.csv", index=False, encoding="utf-8-sig")
    return result


def save_charts(results: pd.DataFrame, labels: pd.Series, predictions: np.ndarray, split_summary: pd.DataFrame) -> None:
    sns.set_theme(style="whitegrid", font_scale=0.9)

    long_results = results.melt(
        id_vars="model",
        value_vars=["accuracy", "precision", "recall", "f1", "roc_auc"],
        var_name="metric",
        value_name="score",
    )
    plt.figure(figsize=(12, 6))
    ax = sns.barplot(data=long_results, x="model", y="score", hue="metric")
    ax.set(title="So sánh mô hình trên tập Validation", xlabel="Mô hình", ylabel="Điểm")
    ax.set_ylim(0, 1.05)
    plt.xticks(rotation=18, ha="right")
    plt.tight_layout()
    plt.savefig(REPORTS_DIR / "model_comparison.png", dpi=180)
    plt.close()

    matrix = confusion_matrix(labels, predictions, labels=[0, 1])
    plt.figure(figsize=(6, 5))
    ax = sns.heatmap(matrix, annot=True, fmt="d", cmap="Oranges", cbar=False)
    ax.set(
        title="Confusion matrix của mô hình tốt nhất trên tập Test",
        xlabel="Nhãn dự đoán",
        ylabel="Nhãn thực tế",
    )
    ax.set_xticklabels(["Bình thường", "Spam"])
    ax.set_yticklabels(["Bình thường", "Spam"], rotation=0)
    plt.tight_layout()
    plt.savefig(REPORTS_DIR / "test_confusion_matrix.png", dpi=180)
    plt.close()

    distribution = split_summary.melt(
        id_vars="split", value_vars=["normal", "spam"], var_name="label", value_name="count"
    )
    distribution["label"] = distribution["label"].map(
        {"normal": "Bình thường", "spam": "Spam"}
    )
    plt.figure(figsize=(8, 5))
    ax = sns.barplot(data=distribution, x="split", y="count", hue="label")
    ax.set(title="Phân bố nhãn theo tập dữ liệu", xlabel="Tập dữ liệu", ylabel="Số tin nhắn")
    ax.legend(title="Nhãn")
    plt.tight_layout()
    plt.savefig(REPORTS_DIR / "class_distribution.png", dpi=180)
    plt.close()


def save_markdown_report(
    results: pd.DataFrame,
    best_name: str,
    test_metrics: dict[str, float],
    split_summary: pd.DataFrame,
) -> None:
    metric_columns = ["accuracy", "precision", "recall", "f1", "roc_auc"]
    comparison_lines = [
        "| Mô hình | Accuracy | Precision | Recall | F1 | ROC-AUC |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for _, row in results.iterrows():
        values = " | ".join(f"{float(row[column]):.4f}" for column in metric_columns)
        comparison_lines.append(f"| {row['model']} | {values} |")

    split_lines = [
        "| Tập | Tổng | Bình thường | Spam | Tỷ lệ spam |",
        "|---|---:|---:|---:|---:|",
    ]
    for _, row in split_summary.iterrows():
        split_lines.append(
            f"| {row['split']} | {int(row['total'])} | {int(row['normal'])} | "
            f"{int(row['spam'])} | {float(row['spam_rate']):.2%} |"
        )

    test_lines = [
        "| Chỉ số | Giá trị |",
        "|---|---:|",
        *[f"| {name} | {value:.4f} |" for name, value in test_metrics.items()],
    ]
    report = "\n".join(
        [
            "# Kết quả phát hiện spam/lừa đảo",
            "",
            "## Phân chia dữ liệu",
            "",
            *split_lines,
            "",
            "![Phân bố nhãn](class_distribution.png)",
            "",
            "## So sánh mô hình trên Validation",
            "",
            *comparison_lines,
            "",
            "![So sánh mô hình](model_comparison.png)",
            "",
            f"Mô hình được chọn theo F1 Validation: **{best_name}**.",
            "",
            "## Kết quả cuối trên Test",
            "",
            *test_lines,
            "",
            "![Confusion matrix](test_confusion_matrix.png)",
            "",
            "Tập Test chỉ được dùng sau khi đã chọn mô hình bằng tập Validation.",
        ]
    )
    (REPORTS_DIR / "MODEL_REPORT.md").write_text(report, encoding="utf-8")


def main() -> None:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    frame = load_dataset(DATA_PATH)
    train, validation, test = split_dataset(frame)
    split_summary = save_split_summary({"train": train, "validation": validation, "test": test})

    validation_rows = []
    models = build_models()
    for name, model in models.items():
        model.fit(train["message"], train["label"])
        validation_rows.append({"model": name, **metrics_for(model, validation["message"], validation["label"])})

    results = pd.DataFrame(validation_rows).sort_values(
        ["f1", "roc_auc", "recall"], ascending=False
    ).reset_index(drop=True)
    results.to_csv(REPORTS_DIR / "validation_model_comparison.csv", index=False, encoding="utf-8-sig")

    best_name = str(results.iloc[0]["model"])
    combined = pd.concat([train, validation], ignore_index=True)
    best_model = clone(models[best_name])
    best_model.fit(combined["message"], combined["label"])
    test_metrics = metrics_for(best_model, test["message"], test["label"])
    test_predictions = best_model.predict(test["message"])

    joblib.dump(best_model, ARTIFACTS_DIR / "best_spam_model.joblib")
    metadata = {
        "best_model": best_name,
        "selection_metric": "validation_f1",
        "random_state": RANDOM_STATE,
        "source_rows": int(len(frame)),
        "split_rows": {row["split"]: int(row["total"]) for _, row in split_summary.iterrows()},
        "validation_metrics": results.iloc[0].drop(labels=["model"]).to_dict(),
        "test_metrics": test_metrics,
        "label_mapping": {"0": "normal", "1": "spam_or_scam"},
    }
    (ARTIFACTS_DIR / "model_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    pd.DataFrame([{"model": best_name, **test_metrics}]).to_csv(
        REPORTS_DIR / "best_model_test_metrics.csv", index=False, encoding="utf-8-sig"
    )
    save_charts(results, test["label"], test_predictions, split_summary)
    save_markdown_report(results, best_name, test_metrics, split_summary)
    dashboard_data = {
        "best_model": best_name,
        "source_rows": int(len(frame)),
        "selection_metric": "F1 Validation",
        "splits": [
            {
                "name": str(row["split"]),
                "total": int(row["total"]),
                "normal": int(row["normal"]),
                "spam": int(row["spam"]),
                "spam_rate": float(row["spam_rate"]),
            }
            for _, row in split_summary.iterrows()
        ],
        "models": [
            {
                "model": str(row["model"]),
                "accuracy": float(row["accuracy"]),
                "precision": float(row["precision"]),
                "recall": float(row["recall"]),
                "f1": float(row["f1"]),
                "roc_auc": float(row["roc_auc"]),
            }
            for _, row in results.iterrows()
        ],
        "test_metrics": test_metrics,
        "confusion_matrix": confusion_matrix(
            test["label"], test_predictions, labels=[0, 1]
        ).tolist(),
    }
    (WEB_DATA_DIR / "dashboard_data.json").write_text(
        json.dumps(dashboard_data, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(results.to_string(index=False, float_format=lambda value: f"{value:.4f}"))
    print(f"\nBest model: {best_name}")
    print(json.dumps(test_metrics, indent=2))


if __name__ == "__main__":
    main()
