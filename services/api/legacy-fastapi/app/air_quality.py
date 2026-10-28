from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class PollutantScale:
    unit: str
    good: float
    elevated: float
    hazardous: float


SCALES: dict[str, PollutantScale] = {
    "CH4": PollutantScale("ppm", 1000, 5000, 10000),
    "NO2": PollutantScale("µg/m³", 40, 100, 200),
    "PM2.5": PollutantScale("µg/m³", 15, 35, 75),
    "SO2": PollutantScale("µg/m³", 40, 125, 350),
    "PM10": PollutantScale("µg/m³", 45, 100, 150),
    "CO": PollutantScale("mg/m³", 4, 7, 10),
    "CO2": PollutantScale("ppm", 800, 1200, 2000),
    "MQ2": PollutantScale("ppm", 300, 600, 1000),
}


def parameter_quality(sensor_type: str, value: float) -> float:
    """Maps a concentration to 0..100 where 100 is clean air."""
    scale = SCALES[sensor_type]
    value = max(0.0, float(value))
    if value <= scale.good:
        score = 100 - 15 * value / max(scale.good, 0.001)
    elif value <= scale.elevated:
        score = 85 - 35 * (value - scale.good) / (scale.elevated - scale.good)
    elif value <= scale.hazardous:
        score = 50 - 50 * (value - scale.elevated) / (scale.hazardous - scale.elevated)
    else:
        score = 0
    return round(max(0.0, min(100.0, score)), 1)


def combined_quality(readings: Iterable[tuple[str, float]]) -> float | None:
    """Average only installed/available parameters; one sensor means one parameter."""
    scores = [parameter_quality(sensor_type, value) for sensor_type, value in readings if sensor_type in SCALES]
    return round(sum(scores) / len(scores), 1) if scores else None


def quality_label(score: float | None) -> str:
    if score is None:
        return "Нет данных"
    if score >= 85:
        return "Чистый воздух"
    if score >= 65:
        return "Умеренно"
    if score >= 40:
        return "Повышено"
    return "Опасно"

