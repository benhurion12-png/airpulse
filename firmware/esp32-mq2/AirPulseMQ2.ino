/*
  AirPulse · ESP32 + CH340 + MQ-2

  Board: ESP32 Dev Module (CH340 is the USB-to-serial bridge)
  Libraries: PubSubClient, ArduinoJson
  MQ-2 AO -> GPIO34 through a safe voltage divider; add a 100 kOhm pull-down
  from GPIO34 to GND so a physically disconnected module always reads near zero.

  A reading is published only when a connected, warmed-up MQ-2 produces a valid
  analogue signal. DEVICE_ID must exactly match the real MQ-2 ID in AirPulse.
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "secrets.h"

constexpr uint8_t MQ2_PIN = 34;
constexpr float ADC_REFERENCE = 3.3;
constexpr float ADC_MAX = 4095.0;
constexpr float LOAD_RESISTANCE_KOHM = 5.0;
constexpr float CLEAN_AIR_FACTOR = 9.83;
constexpr unsigned long SEND_INTERVAL_MS = 15000;
constexpr unsigned long WARMUP_MS = 60000;

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
float r0 = 10.0;
unsigned long lastSent = 0;

float resistanceFromRaw(int raw) {
  if (raw <= 0) return 99999.0;
  float voltage = raw * ADC_REFERENCE / ADC_MAX;
  return LOAD_RESISTANCE_KOHM * (ADC_REFERENCE - voltage) / max(voltage, 0.001f);
}

bool readMq2(float &ppm) {
  const int samples = 40;
  long sum = 0;
  for (int i = 0; i < samples; i++) {
    int raw = analogRead(MQ2_PIN);
    sum += raw;
    delay(8);
  }
  float average = sum / float(samples);
  // The external pull-down makes a disconnected input reliably fall below 90.
  // Rail-clamped inputs are rejected too. A stable valid signal is still real.
  bool connected = average > 90 && average < 4000;
  if (millis() < WARMUP_MS) {
    Serial.printf("MQ-2 warm-up: ADC=%.1f, %lu s remaining\n", average, (WARMUP_MS - millis()) / 1000);
    return false;
  }
  if (!connected) {
    Serial.printf("MQ-2 invalid signal: ADC=%.1f (expected 91..3999)\n", average);
    return false;
  }
  float rs = resistanceFromRaw((int)average);
  float ratio = max(rs / max(r0, 0.1f), 0.01f);
  // Typical MQ-2 LPG/smoke curve approximation. Calibrate r0 for the actual module.
  ppm = constrain(574.25f * pow(ratio, -2.222f), 0.0f, 10000.0f);
  return true;
}

void connectWifi() {
  Serial.printf("Wi-Fi: connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long lastStatus = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
    if (millis() - lastStatus >= 10000) {
      lastStatus = millis();
      Serial.printf(" status=%d", static_cast<int>(WiFi.status()));
    }
  }
  Serial.printf(" connected, IP=%s, RSSI=%d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
}

void connectMqtt() {
  String clientId = String("airpulse-") + DEVICE_ID;
  while (!mqtt.connected()) {
    Serial.printf("MQTT: connecting to %s:%u as %s... ", MQTT_HOST, MQTT_PORT, clientId.c_str());
    if (mqtt.connect(clientId.c_str())) {
      Serial.println("connected");
    } else {
      Serial.printf("failed, state=%d; retrying in 2 s\n", mqtt.state());
      delay(2000);
    }
  }
}

void publishReading() {
  float ppm;
  if (!readMq2(ppm)) {
    Serial.println("MQ-2: no valid reading (warming up, disconnected, or invalid ADC signal)");
    return;
  }
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["type"] = "MQ2";
  doc["value"] = ppm;
  doc["unit"] = "ppm";
  doc["source"] = "REAL";
  doc["sensorConnected"] = true;
  char payload[256];
  serializeJson(doc, payload, sizeof(payload));
  String topic = String("airpulse/devices/") + DEVICE_ID + "/telemetry";
  bool published = mqtt.publish(topic.c_str(), payload, true);
  Serial.printf(
    "MQ-2 [%s]: %.2f ppm (real), MQTT publish=%s\n",
    DEVICE_ID,
    ppm,
    published ? "ok" : "failed"
  );
}

void setup() {
  Serial.begin(115200);
  Serial.printf("AirPulse device ID: %s\n", DEVICE_ID);
  analogReadResolution(12);
  analogSetPinAttenuation(MQ2_PIN, ADC_11db);
  connectWifi();
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();
  if (millis() - lastSent >= SEND_INTERVAL_MS) {
    lastSent = millis();
    publishReading();
  }
}

