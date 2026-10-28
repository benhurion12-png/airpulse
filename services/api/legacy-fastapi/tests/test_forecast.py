from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.forecast import forecast_quality


@dataclass
class Row:
    type: str
    value: float
    measured_at: datetime


def test_regression_detects_rising_pollution():
    start = datetime.now(timezone.utc) - timedelta(hours=5)
    rows = [Row("PM2.5", 10 + index * 2, start + timedelta(hours=index)) for index in range(6)]
    result = forecast_quality(rows, 60)
    assert result["parameters"][0]["predicted"] > result["parameters"][0]["current"]
    assert result["method"] == "linear-regression-v1"

