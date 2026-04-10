from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Any

import joblib

# Try to import NumPy and sklearn; if unavailable (e.g. blocked by system App Control),
# provide a minimal fallback so the backend can still run for demos/tests.
_NUMPY_SKLEARN_AVAILABLE = True
try:
    import numpy as np
    from sklearn.ensemble import RandomForestClassifier
except Exception:
    _NUMPY_SKLEARN_AVAILABLE = False

    class RandomForestClassifier:
        """Lightweight fallback model used when numpy/sklearn are not importable."""
        classes_ = [0, 1, 2]

        def __init__(self, **kwargs):
            pass

        def fit(self, _X, _y):
            return self

        def predict_proba(self, X):
            out = []
            for row in X:
                rainfall = float(row[0])
                temp = float(row[1])
                cases = float(row[2])
                latent = 0.18 * rainfall + 0.85 * max(temp - 19, 0) + 0.70 * cases
                if latent > 150:
                    out.append([0.05, 0.25, 0.70])
                elif latent > 60:
                    out.append([0.10, 0.70, 0.20])
                else:
                    out.append([0.80, 0.18, 0.02])
            return out

        def predict(self, X):
            probs = self.predict_proba(X)
            classes = []
            for p in probs:
                classes.append(int(p.index(max(p))))
            return classes


@dataclass
class OutbreakPrediction:
    risk_score: int
    status: str


MODEL_VERSION = "1.0"
DEFAULT_MODEL_PATH = Path(__file__).resolve().parent / "artifacts" / "outbreak_rf_v1.joblib"
MODEL_PATH = Path(os.getenv("MODEL_ARTIFACT_PATH", str(DEFAULT_MODEL_PATH)))
if not MODEL_PATH.is_absolute():
    MODEL_PATH = (Path(__file__).resolve().parent / MODEL_PATH).resolve()
ARTIFACTS_DIR = MODEL_PATH.parent


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(value, maximum))


def _generate_training_data(sample_count: int = 1600, seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    """Create synthetic but structured data to bootstrap a baseline classifier."""
    rng = np.random.default_rng(seed)

    rainfall_mm = rng.uniform(0, 320, sample_count)
    temperature_c = rng.uniform(12, 43, sample_count)
    reported_fever_cases = rng.integers(0, 360, sample_count)

    # Domain-inspired latent score used only to create supervised labels.
    latent_score = (
        0.18 * rainfall_mm
        + 0.85 * np.maximum(temperature_c - 19, 0)
        + 0.70 * reported_fever_cases
        + rng.normal(0, 7.0, sample_count)
    )

    low_risk_threshold = np.percentile(latent_score, 35)
    high_risk_threshold = np.percentile(latent_score, 72)

    labels = np.where(latent_score >= high_risk_threshold, 2, np.where(latent_score >= low_risk_threshold, 1, 0))
    features = np.column_stack((rainfall_mm, temperature_c, reported_fever_cases)).astype(np.float64)
    return features, labels.astype(np.int32)


def _train_model() -> RandomForestClassifier:
    features, labels = _generate_training_data()
    model = RandomForestClassifier(
        n_estimators=220,
        max_depth=8,
        min_samples_leaf=4,
        random_state=42,
    )
    model.fit(features, labels)
    return model


def _load_model_from_disk() -> RandomForestClassifier | None:
    if not MODEL_PATH.exists():
        return None

    try:
        payload: dict[str, Any] = joblib.load(MODEL_PATH)
    except Exception:
        return None

    if payload.get("model_version") != MODEL_VERSION:
        return None

    model = payload.get("model")
    if not isinstance(model, RandomForestClassifier):
        return None

    return model


def _save_model_to_disk(model: RandomForestClassifier) -> None:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "model_version": MODEL_VERSION,
        "model": model,
    }
    joblib.dump(payload, MODEL_PATH)


def _load_or_train_model() -> RandomForestClassifier:
    if not _NUMPY_SKLEARN_AVAILABLE:
        # Return the lightweight fallback model when numeric libraries are blocked.
        return RandomForestClassifier()

    existing_model = _load_model_from_disk()
    if existing_model is not None:
        return existing_model

    trained_model = _train_model()
    _save_model_to_disk(trained_model)
    return trained_model


MODEL = _load_or_train_model()


def predict_outbreak(rainfall_mm: float, temperature_c: float, reported_fever_cases: int) -> OutbreakPrediction:
    if _NUMPY_SKLEARN_AVAILABLE:
        features = np.array([[rainfall_mm, temperature_c, float(reported_fever_cases)]], dtype=np.float64)
    else:
        # Use plain Python lists for the fallback model
        features = [[rainfall_mm, temperature_c, float(reported_fever_cases)]]

    probabilities = MODEL.predict_proba(features)[0]
    class_to_probability = {int(class_label): float(probability) for class_label, probability in zip(MODEL.classes_, probabilities)}

    low_probability = class_to_probability.get(0, 0.0)
    warning_probability = class_to_probability.get(1, 0.0)
    critical_probability = class_to_probability.get(2, 0.0)

    weighted_risk = (warning_probability * 0.6) + critical_probability
    confidence_adjusted_score = weighted_risk * (1.0 - (0.25 * low_probability))
    risk_score = int(round(_clamp(confidence_adjusted_score * 100.0, 0.0, 100.0)))

    predicted_class = int(MODEL.predict(features)[0])
    if predicted_class == 2:
        status = "Critical Outbreak Risk"
        risk_score = max(risk_score, 70)
    elif predicted_class == 1:
        status = "Warning"
        risk_score = int(_clamp(risk_score, 35, 69))
    else:
        status = "Safe"
        risk_score = min(risk_score, 34)

    return OutbreakPrediction(risk_score=risk_score, status=status)
