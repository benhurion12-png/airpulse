import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from threading import Thread
from time import sleep

import paho.mqtt.client as mqtt
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import desc, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .air_quality import SCALES, combined_quality, parameter_quality, quality_label
from .auth import TokenError, create_token_pair, decode_token, hash_password, verify_password
from .database import Base, SessionLocal, engine
from .forecast import forecast_quality
from .models import Location, Reading, Sensor, User
from .schemas import LoginIn, LocationCreate, RefreshIn, RegisterIn, SensorCreate, TelemetryIn, UNITS, UserActiveUpdate, UserRoleUpdate
from .seed import seed_database


def get_db():
    with SessionLocal() as db:
        yield db


def api_key_guard(x_admin_key: str | None = Header(default=None)):
    if not x_admin_key or not hmac_compare(x_admin_key, os.getenv("ADMIN_KEY", "airpulse-admin")):
        raise HTTPException(status_code=403, detail="Нужен ключ администратора")


def _serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "isActive": user.is_active,
        "createdAt": user.created_at.isoformat(),
    }


def _user_from_authorization(authorization: str | None, db: Session) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Войдите в систему", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = decode_token(authorization.split(" ", 1)[1].strip(), "access")
    except TokenError as exc:
        raise HTTPException(status_code=401, detail=str(exc), headers={"WWW-Authenticate": "Bearer"}) from exc
    user = db.get(User, payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Пользователь не найден или отключён")
    return user


def current_user(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> User:
    return _user_from_authorization(authorization, db)


def staff_guard(
    authorization: str | None = Header(default=None),
    x_admin_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User | None:
    if x_admin_key and hmac_compare(x_admin_key, os.getenv("ADMIN_KEY", "airpulse-admin")):
        return None
    user = _user_from_authorization(authorization, db)
    if user.role not in {"OPERATOR", "ADMIN"}:
        raise HTTPException(status_code=403, detail="Нужна роль оператора или администратора")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Нужна роль администратора")
    return user


def hmac_compare(left: str, right: str) -> bool:
    import hmac
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


def seed_admin_user() -> None:
    email = os.getenv("ADMIN_EMAIL", "admin@airpulse.local").strip().lower()
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.email == email)):
            return
        db.add(User(
            name=os.getenv("ADMIN_NAME", "Администратор AirPulse").strip() or "Администратор AirPulse",
            email=email,
            password_hash=hash_password(os.getenv("ADMIN_PASSWORD", "ChangeMe123!")),
            role="ADMIN",
        ))
        db.commit()


def _serialize_sensor(sensor: Sensor, latest: Reading | None = None) -> dict:
    online = bool(sensor.last_seen and sensor.last_seen.replace(tzinfo=timezone.utc) >= datetime.now(timezone.utc) - timedelta(minutes=5))
    return {
        "id": sensor.id,
        "name": sensor.name,
        "type": sensor.type,
        "mode": sensor.mode,
        "unit": sensor.unit,
        "locationId": sensor.location_id,
        "isActive": sensor.is_active,
        "online": online,
        "lastSeen": sensor.last_seen.isoformat() if sensor.last_seen else None,
        "value": round(latest.value, 2) if latest else None,
        "quality": parameter_quality(sensor.type, latest.value) if latest else None,
    }


def _latest_for_location(db: Session, location: Location) -> list[tuple[Sensor, Reading | None]]:
    result = []
    for sensor in sorted(location.sensors, key=lambda item: item.type):
        latest = db.scalar(select(Reading).where(Reading.sensor_id == sensor.id).order_by(desc(Reading.measured_at)).limit(1))
        result.append((sensor, latest))
    return result


def _location_view(db: Session, location: Location, with_forecast: bool = True) -> dict:
    sensor_rows = _latest_for_location(db, location)
    values = [(sensor.type, reading.value) for sensor, reading in sensor_rows if sensor.is_active and reading]
    score = combined_quality(values)
    forecast = None
    if with_forecast:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
        rows = db.scalars(select(Reading).where(Reading.location_id == location.id, Reading.measured_at >= cutoff).order_by(Reading.measured_at)).all()
        forecast = forecast_quality(rows)
    return {
        "id": location.id,
        "name": location.name,
        "city": location.city,
        "address": location.address,
        "latitude": location.latitude,
        "longitude": location.longitude,
        "score": score,
        "status": quality_label(score),
        "sensors": [_serialize_sensor(sensor, reading) for sensor, reading in sensor_rows],
        "forecast": forecast,
    }


def _device_id_from_topic(topic: str) -> str | None:
    parts = topic.split("/")
    if len(parts) != 4 or parts[0] != "airpulse" or parts[1] != "devices" or parts[3] != "telemetry":
        return None
    return parts[2] or None


def ingest_payload(payload: dict, topic_device_id: str | None = None) -> bool:
    try:
        telemetry = TelemetryIn.model_validate(payload)
    except Exception:
        return False
    if topic_device_id is not None and topic_device_id != telemetry.deviceId:
        return False
    with SessionLocal() as db:
        sensor = db.get(Sensor, telemetry.deviceId)
        if not sensor or not sensor.is_active or sensor.type != telemetry.type:
            return False
        if sensor.mode == "REAL":
            if sensor.type != "MQ2" or telemetry.source != "REAL":
                return False
        elif telemetry.source != "SIMULATED":
            return False
        try:
            measured_at = datetime.fromisoformat(telemetry.measuredAt.replace("Z", "+00:00")) if telemetry.measuredAt else datetime.now(timezone.utc)
        except ValueError:
            measured_at = datetime.now(timezone.utc)
        db.add(Reading(
            sensor_id=sensor.id,
            location_id=sensor.location_id,
            type=sensor.type,
            value=telemetry.value,
            unit=UNITS[sensor.type],
            source=telemetry.source,
            measured_at=measured_at,
        ))
        sensor.last_seen = datetime.now(timezone.utc)
        db.commit()
    return True


def mqtt_worker() -> None:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="airpulse-api")
    client.reconnect_delay_set(1, 30)

    def on_connect(current, _userdata, _flags, reason_code, _properties):
        if reason_code == 0:
            current.subscribe("airpulse/devices/+/telemetry", qos=1)

    def on_message(_client, _userdata, message):
        try:
            topic_device_id = _device_id_from_topic(message.topic)
            if topic_device_id is None:
                return
            ingest_payload(json.loads(message.payload.decode("utf-8")), topic_device_id)
        except Exception as exc:
            print(f"MQTT message rejected: {exc}", flush=True)

    client.on_connect = on_connect
    client.on_message = on_message
    while True:
        try:
            client.connect(os.getenv("MQTT_HOST", "localhost"), int(os.getenv("MQTT_PORT", "1883")), 30)
            client.loop_forever()
        except Exception as exc:
            print(f"MQTT unavailable: {exc}; retrying", flush=True)
            sleep(5)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(engine)
    seed_database()
    seed_admin_user()
    Thread(target=mqtt_worker, name="mqtt", daemon=True).start()
    yield


app = FastAPI(title="AirPulse API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[item.strip() for item in os.getenv("APP_ORIGINS", "http://localhost:3000").split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/auth/register", status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    user = User(name=body.name, email=body.email, password_hash=hash_password(body.password), role="CLIENT")
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Пользователь с таким email уже существует")
    return {**create_token_pair(user.id, user.role), "user": _serialize_user(user)}


@app.post("/api/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Учётная запись отключена администратором")
    return {**create_token_pair(user.id, user.role), "user": _serialize_user(user)}


@app.post("/api/auth/refresh")
def refresh_auth(body: RefreshIn, db: Session = Depends(get_db)):
    try:
        payload = decode_token(body.refreshToken, "refresh")
    except TokenError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    user = db.get(User, payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Пользователь не найден или отключён")
    return {**create_token_pair(user.id, user.role), "user": _serialize_user(user)}


@app.get("/api/auth/me")
def auth_me(user: User = Depends(current_user)):
    return _serialize_user(user)


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.scalar(select(func.count(Location.id)))
    return {"status": "ok", "service": "airpulse-api", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/meta")
def meta():
    return {"sensorTypes": [{"type": key, **vars(value)} for key, value in SCALES.items()], "region": "Северо-Казахстанская область"}


@app.get("/api/dashboard")
def dashboard(_user: User = Depends(current_user), db: Session = Depends(get_db)):
    locations = [_location_view(db, item) for item in db.scalars(select(Location).order_by(Location.name)).all()]
    scores = [item["score"] for item in locations if item["score"] is not None]
    sensors = [sensor for item in locations for sensor in item["sensors"]]
    return {
        "region": "Северо-Казахстанская область",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "overallScore": round(sum(scores) / len(scores), 1) if scores else None,
        "onlineSensors": sum(1 for sensor in sensors if sensor["online"]),
        "totalSensors": len(sensors),
        "locations": locations,
    }


@app.get("/api/locations")
def locations(_user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [_location_view(db, item, with_forecast=False) for item in db.scalars(select(Location).order_by(Location.name)).all()]


@app.post("/api/locations", dependencies=[Depends(staff_guard)], status_code=201)
def create_location(body: LocationCreate, db: Session = Depends(get_db)):
    item = Location(**body.model_dump())
    db.add(item)
    try:
        db.commit()
        db.refresh(item)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Объект с таким названием уже существует")
    return _location_view(db, item, with_forecast=False)


@app.get("/api/locations/{location_id}/history")
def location_history(location_id: str, hours: int = Query(default=24, ge=1, le=168), _user: User = Depends(current_user), db: Session = Depends(get_db)):
    location = db.get(Location, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Объект не найден")
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = db.scalars(select(Reading).where(Reading.location_id == location_id, Reading.measured_at >= cutoff).order_by(Reading.measured_at)).all()
    buckets: dict[str, dict[str, list[float]]] = {}
    for row in rows:
        key = row.measured_at.replace(minute=(row.measured_at.minute // 30) * 30, second=0, microsecond=0).isoformat()
        buckets.setdefault(key, {}).setdefault(row.type, []).append(row.value)
    points = []
    for stamp, values in sorted(buckets.items()):
        averaged = [(key, sum(nums) / len(nums)) for key, nums in values.items()]
        points.append({"at": stamp, "score": combined_quality(averaged), "values": {key: round(sum(nums) / len(nums), 2) for key, nums in values.items()}})
    return {"locationId": location_id, "points": points}


@app.get("/api/locations/{location_id}/forecast")
def location_forecast(location_id: str, minutes: int = Query(default=60, ge=15, le=360), _user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not db.get(Location, location_id):
        raise HTTPException(status_code=404, detail="Объект не найден")
    cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
    rows = db.scalars(select(Reading).where(Reading.location_id == location_id, Reading.measured_at >= cutoff).order_by(Reading.measured_at)).all()
    return forecast_quality(rows, minutes)


@app.get("/api/sensors")
def sensors(_user: User = Depends(current_user), db: Session = Depends(get_db)):
    result = []
    for sensor in db.scalars(select(Sensor).order_by(Sensor.created_at.desc())).all():
        latest = db.scalar(select(Reading).where(Reading.sensor_id == sensor.id).order_by(desc(Reading.measured_at)).limit(1))
        result.append(_serialize_sensor(sensor, latest))
    return result


@app.post("/api/sensors", dependencies=[Depends(staff_guard)], status_code=201)
def create_sensor(body: SensorCreate, db: Session = Depends(get_db)):
    if not db.get(Location, body.location_id):
        raise HTTPException(status_code=404, detail="Объект не найден")
    sensor = Sensor(**body.model_dump(), unit=UNITS[body.type])
    db.add(sensor)
    try:
        db.commit()
        db.refresh(sensor)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="ID датчика уже используется")
    return _serialize_sensor(sensor)


@app.patch("/api/sensors/{sensor_id}/mode", dependencies=[Depends(staff_guard)])
def update_sensor_mode(sensor_id: str, mode: str, db: Session = Depends(get_db)):
    sensor = db.get(Sensor, sensor_id)
    if not sensor:
        raise HTTPException(status_code=404, detail="Датчик не найден")
    if mode not in {"SIMULATED", "REAL"} or mode == "REAL" and sensor.type != "MQ2":
        raise HTTPException(status_code=422, detail="Режим REAL доступен только для MQ-2")
    sensor.mode = mode
    db.commit()
    return _serialize_sensor(sensor)


@app.get("/api/users")
def users(_admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    return [_serialize_user(user) for user in db.scalars(select(User).order_by(User.created_at.desc())).all()]


@app.patch("/api/users/{user_id}/role")
def update_user_role(user_id: str, body: UserRoleUpdate, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if user.id == admin.id and body.role != "ADMIN":
        raise HTTPException(status_code=422, detail="Нельзя снять роль администратора у самого себя")
    user.role = body.role
    db.commit()
    db.refresh(user)
    return _serialize_user(user)


@app.patch("/api/users/{user_id}/active")
def update_user_active(user_id: str, body: UserActiveUpdate, admin: User = Depends(admin_user), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if user.id == admin.id and not body.isActive:
        raise HTTPException(status_code=422, detail="Нельзя отключить собственную учётную запись")
    user.is_active = body.isActive
    db.commit()
    db.refresh(user)
    return _serialize_user(user)


@app.post("/api/telemetry", dependencies=[Depends(api_key_guard)])
def telemetry(body: TelemetryIn):
    if not ingest_payload(body.model_dump()):
        raise HTTPException(status_code=422, detail="Телеметрия отклонена")
    return {"accepted": True}


@app.get("/api/simulator/sensors")
def simulator_sensors(x_simulator_token: str | None = Header(default=None), db: Session = Depends(get_db)):
    if x_simulator_token != os.getenv("SIMULATOR_TOKEN", "airpulse-simulator"):
        raise HTTPException(status_code=403, detail="Неверный токен симулятора")
    items = db.scalars(select(Sensor).where(Sensor.mode == "SIMULATED", Sensor.is_active.is_(True))).all()
    return [{"id": item.id, "type": item.type, "unit": item.unit, "locationId": item.location_id} for item in items]

