#pragma once

#include <stdint.h>

// Скопируйте этот файл как secrets.h и замените значения на свои.
// secrets.h добавлен в .gitignore и не попадёт в Git.
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* MQTT_HOST = "192.168.1.100"; // IPv4 компьютера, где запущен Docker
const uint16_t MQTT_PORT = 1886;
const char* DEVICE_ID = "mq2-real-001";  // Тот же ID создайте в AirPulse
