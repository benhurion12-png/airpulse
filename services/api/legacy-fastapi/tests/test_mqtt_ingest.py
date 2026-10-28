from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.main as main_module
from app.database import Base
from app.models import Location, Reading, Sensor


def _payload(device_id: str = "mq2-real-001", source: str = "REAL") -> dict:
    return {
        "deviceId": device_id,
        "type": "MQ2",
        "value": 321.5,
        "unit": "ppm",
        "source": source,
    }


def _reading_count(session_factory) -> int:
    with session_factory() as db:
        return db.scalar(select(func.count(Reading.id)))


def test_real_mq2_is_ingested_only_when_topic_and_payload_ids_match(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(main_module, "SessionLocal", session_factory)

    with session_factory() as db:
        location = Location(
            id="test-location",
            name="Test location",
            city="Petropavl",
            latitude=54.87,
            longitude=69.15,
        )
        db.add(location)
        db.add(Sensor(
            id="mq2-real-001",
            name="MQ-2",
            type="MQ2",
            mode="REAL",
            unit="ppm",
            location_id=location.id,
        ))
        db.commit()

    assert not main_module.ingest_payload(_payload(), "another-device")
    assert _reading_count(session_factory) == 0

    assert main_module.ingest_payload(_payload(), "mq2-real-001")
    assert _reading_count(session_factory) == 1

    engine.dispose()


def test_real_mq2_rejects_simulated_values(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(main_module, "SessionLocal", session_factory)

    with session_factory() as db:
        location = Location(
            id="test-location",
            name="Test location",
            city="Petropavl",
            latitude=54.87,
            longitude=69.15,
        )
        db.add(location)
        db.add(Sensor(
            id="mq2-real-001",
            name="MQ-2",
            type="MQ2",
            mode="REAL",
            unit="ppm",
            location_id=location.id,
        ))
        db.commit()

    assert not main_module.ingest_payload(_payload(source="SIMULATED"), "mq2-real-001")
    assert _reading_count(session_factory) == 0

    engine.dispose()


def test_device_id_is_read_only_from_expected_topic_shape():
    assert main_module._device_id_from_topic("airpulse/devices/mq2-real-001/telemetry") == "mq2-real-001"
    assert main_module._device_id_from_topic("airpulse/devices/mq2-real-001/status") is None
    assert main_module._device_id_from_topic("airpulse/devices//telemetry") is None
