from typing import Literal
from pydantic import BaseModel, Field, field_validator, model_validator


SensorType = Literal["CH4", "NO2", "PM2.5", "SO2", "PM10", "CO", "CO2", "MQ2"]
SensorMode = Literal["SIMULATED", "REAL"]
UserRole = Literal["CLIENT", "OPERATOR", "ADMIN"]


UNITS = {
    "CH4": "ppm",
    "NO2": "µg/m³",
    "PM2.5": "µg/m³",
    "SO2": "µg/m³",
    "PM10": "µg/m³",
    "CO": "mg/m³",
    "CO2": "ppm",
    "MQ2": "ppm",
}


def normalize_email(value: str) -> str:
    normalized = value.strip().lower()
    if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@") or "." not in normalized.split("@", 1)[1]:
        raise ValueError("Введите корректный email")
    return normalized


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=180)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str):
        return " ".join(value.split())

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str):
        return normalize_email(value)

    @field_validator("password")
    @classmethod
    def strong_password(cls, value: str):
        if not any(char.isalpha() for char in value) or not any(char.isdigit() for char in value):
            raise ValueError("Пароль должен содержать буквы и цифры")
        return value


class LoginIn(BaseModel):
    email: str = Field(min_length=5, max_length=180)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def clean_email(cls, value: str):
        return normalize_email(value)


class RefreshIn(BaseModel):
    refreshToken: str = Field(min_length=20, max_length=4096)


class UserRoleUpdate(BaseModel):
    role: UserRole


class UserActiveUpdate(BaseModel):
    isActive: bool


class LocationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    city: str = Field(min_length=2, max_length=100)
    address: str = Field(default="", max_length=180)
    latitude: float = Field(ge=52.7, le=56.0)
    longitude: float = Field(ge=65.5, le=72.5)


class SensorCreate(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{3,64}$")
    name: str = Field(min_length=2, max_length=120)
    type: SensorType
    mode: SensorMode = "SIMULATED"
    location_id: str

    @model_validator(mode="after")
    def real_only_for_mq2(self):
        if self.mode == "REAL" and self.type != "MQ2":
            raise ValueError("Режим REAL доступен только для общего датчика MQ-2")
        return self


class TelemetryIn(BaseModel):
    deviceId: str = Field(pattern=r"^[A-Za-z0-9_-]{3,64}$")
    type: SensorType
    value: float = Field(ge=0, le=1_000_000)
    unit: str | None = None
    source: str = "REAL"
    measuredAt: str | None = None

    @field_validator("source")
    @classmethod
    def source_name(cls, value: str):
        normalized = value.upper()
        if normalized not in {"REAL", "SIMULATED"}:
            raise ValueError("Источник должен быть REAL или SIMULATED")
        return normalized

