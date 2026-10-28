from collections import defaultdict
from datetime import datetime
from math import sqrt
from statistics import fmean
from typing import Iterable

from .air_quality import combined_quality


def _linear_regression(points: list[tuple[float, float]]) -> tuple[float, float, float]:
    """Ordinary least squares: slope, intercept and R²."""
    if len(points) < 2:
        return 0.0, points[0][1] if points else 0.0, 0.0
    xs, ys = zip(*points)
    mx, my = fmean(xs), fmean(ys)
    variance = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in points) / variance if variance else 0.0
    intercept = my - slope * mx
    predicted = [slope * x + intercept for x in xs]
    total = sum((y - my) ** 2 for y in ys)
    residual = sum((y - p) ** 2 for y, p in zip(ys, predicted))
    r2 = max(0.0, 1.0 - residual / total) if total else 0.0
    return slope, intercept, r2


def forecast_quality(rows: Iterable[object], minutes: int = 60) -> dict:
    """Forecast every installed pollutant with regression, then recompute the combined score."""
    groups: dict[str, list[tuple[datetime, float]]] = defaultdict(list)
    for row in rows:
        groups[row.type].append((row.measured_at, float(row.value)))
    if not groups:
        return {"score": None, "confidence": 0, "method": "linear-regression-v1", "parameters": []}

    all_dates = [date for values in groups.values() for date, _ in values]
    start = min(all_dates)
    horizon = max((date - start).total_seconds() / 60 for date in all_dates) + minutes
    parameters = []
    scores = []
    for sensor_type, values in sorted(groups.items()):
        points = sorted(((date - start).total_seconds() / 60, value) for date, value in values)[-192:]
        slope, intercept, r2 = _linear_regression(points)
        # Avoid implausible runaway extrapolation from a noisy short window.
        current = points[-1][1]
        raw = slope * horizon + intercept
        predicted = max(0.0, min(raw, current * 1.5 + 0.001))
        parameters.append({
            "type": sensor_type,
            "current": round(current, 2),
            "predicted": round(predicted, 2),
            "trendPerHour": round(slope * 60, 3),
            "r2": round(r2, 3),
            "samples": len(points),
        })
        scores.append((sensor_type, predicted))
    sample_factor = min(1.0, sum(item["samples"] for item in parameters) / (24 * len(parameters)))
    fit_factor = sqrt(fmean([item["r2"] for item in parameters])) if parameters else 0
    confidence = round(100 * (0.55 * sample_factor + 0.45 * fit_factor))
    return {
        "score": combined_quality(scores),
        "confidence": confidence,
        "horizonMinutes": minutes,
        "method": "linear-regression-v1",
        "parameters": parameters,
    }

