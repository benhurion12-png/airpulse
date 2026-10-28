import math
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from .database import SessionLocal
from .models import Location, Reading, Sensor
from .schemas import UNITS


LOCATIONS = [
    ("Северный промышленный узел", "Петропавловск", "ул. Индустриальная, 12", 54.9158, 69.1504),
    ("Элеватор Тайынша", "Тайынша", "Промышленная зона", 53.8478, 69.7639),
    ("Складской комплекс Булаево", "Булаево", "ул. Железнодорожная, 18", 54.9056, 70.4439),
    ("Сергеевский энергоузел", "Сергеевка", "Энергетический проезд, 4", 53.8814, 67.4158),
]

BASELINES = {"CH4": 720, "NO2": 34, "PM2.5": 19, "SO2": 28, "PM10": 42, "CO": 2.1, "CO2": 610, "MQ2": 240}


def seed_database() -> None:
    with SessionLocal() as db:
        if db.scalar(select(func.count(Location.id))):
            return
        random.seed(2409)
        locations = [Location(name=n, city=c, address=a, latitude=lat, longitude=lon) for n, c, a, lat, lon in LOCATIONS]
        db.add_all(locations)
        db.flush()
        sensor_types = list(UNITS)
        for location_index, location in enumerate(locations):
            # The first demo object deliberately has one sensor to demonstrate one-parameter scoring.
            chosen = ["PM2.5"] if location_index == 3 else sensor_types[location_index : location_index + 5]
            for sensor_index, sensor_type in enumerate(chosen):
                sensor_id = f"sko-{location_index + 1}-{sensor_type.lower().replace('.', '')}-{sensor_index + 1}"
                sensor = Sensor(
                    id=sensor_id,
                    name=f"{sensor_type} · {location.city}",
                    type=sensor_type,
                    mode="SIMULATED",
                    unit=UNITS[sensor_type],
                    location_id=location.id,
                )
                db.add(sensor)
                db.flush()
                baseline = BASELINES[sensor_type] * (0.82 + location_index * 0.09)
                for step in range(96):
                    measured_at = datetime.now(timezone.utc) - timedelta(minutes=(95 - step) * 30)
                    daily = math.sin(step / 7.5 + location_index) * baseline * 0.09
                    trend = step / 95 * baseline * (0.035 if location_index == 1 else -0.012)
                    noise = random.gauss(0, baseline * 0.035)
                    db.add(Reading(
                        sensor_id=sensor.id,
                        location_id=location.id,
                        type=sensor_type,
                        value=max(0, baseline + daily + trend + noise),
                        unit=UNITS[sensor_type],
                        source="SEED",
                        measured_at=measured_at,
                    ))
                sensor.last_seen = datetime.now(timezone.utc)
        db.commit()

