import json
import math
import os
import random
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
import requests


API_URL = os.getenv("API_URL", "http://localhost:8000")
MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
TOKEN = os.getenv("SIMULATOR_TOKEN", "airpulse-simulator")
INTERVAL = max(2.0, float(os.getenv("INTERVAL_SECONDS", "15")))

PROFILES = {
    "CH4": (720.0, 80.0, 80.0, 2500.0),
    "NO2": (32.0, 6.0, 4.0, 180.0),
    "PM2.5": (18.0, 4.5, 5.0, 90.0),
    "SO2": (25.0, 5.0, 5.0, 250.0),
    "PM10": (39.0, 8.0, 8.0, 170.0),
    "CO": (1.8, 0.4, 0.3, 9.0),
    "CO2": (590.0, 60.0, 55.0, 1500.0),
    "MQ2": (230.0, 35.0, 25.0, 850.0),
}


def fetch_sensors() -> list[dict]:
    response = requests.get(
        f"{API_URL}/api/simulator/sensors",
        headers={"X-Simulator-Token": TOKEN},
        timeout=10,
    )
    response.raise_for_status()
    return response.json()


def sample(sensor: dict, tick: int) -> float:
    baseline, wave, noise, incident = PROFILES[sensor["type"]]
    phase = (sum(ord(char) for char in sensor["id"]) % 31) / 4
    daily = math.sin(tick / 34 + phase) * wave
    rush = max(0.0, math.sin(tick / 11 + phase / 2)) ** 5 * wave * 0.9
    # A short deterministic episode makes forecasts and alerts visible in a demo.
    episode = incident * 0.22 if (tick + int(phase)) % 180 in range(118, 132) else 0
    return round(max(0.0, baseline + daily + rush + episode + random.gauss(0, noise)), 3)


def connect() -> mqtt.Client:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="airpulse-simulator")
    client.reconnect_delay_set(1, 20)
    client.connect(MQTT_HOST, MQTT_PORT, 30)
    client.loop_start()
    return client


def main() -> None:
    random.seed()
    while True:
        try:
            client = connect()
            break
        except OSError as exc:
            print(f"MQTT is not ready: {exc}", flush=True)
            time.sleep(3)
    tick = 0
    sensors: list[dict] = []
    refreshed_at = 0.0
    while True:
        try:
            if time.time() - refreshed_at > 30:
                sensors = fetch_sensors()
                refreshed_at = time.time()
                print(f"Simulating {len(sensors)} sensors", flush=True)
            stamp = datetime.now(timezone.utc).isoformat()
            for sensor in sensors:
                payload = {
                    "deviceId": sensor["id"],
                    "type": sensor["type"],
                    "value": sample(sensor, tick),
                    "unit": sensor["unit"],
                    "source": "SIMULATED",
                    "measuredAt": stamp,
                }
                topic = f"airpulse/devices/{sensor['id']}/telemetry"
                client.publish(topic, json.dumps(payload, ensure_ascii=False), qos=1)
            tick += 1
        except Exception as exc:
            print(f"Simulation cycle failed: {exc}", flush=True)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()

