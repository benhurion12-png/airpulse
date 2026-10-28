from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="CLIENT", index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(120), unique=True)
    city: Mapped[str] = mapped_column(String(100))
    address: Mapped[str] = mapped_column(String(180), default="")
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    sensors: Mapped[list["Sensor"]] = relationship(back_populates="location", cascade="all, delete-orphan")


class Sensor(Base):
    __tablename__ = "sensors"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(16), index=True)
    mode: Mapped[str] = mapped_column(String(16), default="SIMULATED")
    unit: Mapped[str] = mapped_column(String(16))
    location_id: Mapped[str] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)
    location: Mapped[Location] = relationship(back_populates="sensors")
    readings: Mapped[list["Reading"]] = relationship(back_populates="sensor", cascade="all, delete-orphan")


class Reading(Base):
    __tablename__ = "readings"
    __table_args__ = (Index("ix_readings_location_time", "location_id", "measured_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    sensor_id: Mapped[str] = mapped_column(ForeignKey("sensors.id", ondelete="CASCADE"), index=True)
    location_id: Mapped[str] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(16), index=True)
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(16))
    source: Mapped[str] = mapped_column(String(16), default="SIMULATED")
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)
    sensor: Mapped[Sensor] = relationship(back_populates="readings")

