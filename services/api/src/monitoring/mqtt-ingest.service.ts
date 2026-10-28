import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import mqtt, { MqttClient } from "mqtt";
import { SENSOR_TYPES, TelemetryDto } from "./monitoring.dto";
import { MonitoringService } from "./monitoring.service";

@Injectable()
export class MqttIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttIngestService.name);
  private client?: MqttClient;

  constructor(private readonly monitoring: MonitoringService, private readonly config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>("MQTT_HOST") ?? "localhost";
    const port = Number(this.config.get("MQTT_PORT") ?? 1883);
    this.client = mqtt.connect(`mqtt://${host}:${port}`, { clientId: "airpulse-nest-api", reconnectPeriod: 1_000 });
    this.client.on("connect", () => {
      this.logger.log(`MQTT connected to ${host}:${port}`);
      this.client?.subscribe("airpulse/devices/+/telemetry", { qos: 1 });
    });
    this.client.on("message", (topic, raw) => void this.handle(topic, raw));
    this.client.on("error", (error) => this.logger.warn(`MQTT unavailable: ${error.message}`));
  }

  onModuleDestroy() {
    this.client?.end(true);
  }

  private async handle(topic: string, raw: Buffer) {
    try {
      const match = /^airpulse\/devices\/([^/]+)\/telemetry$/.exec(topic);
      if (!match) return;
      const payload = JSON.parse(raw.toString("utf8")) as TelemetryDto;
      if (!SENSOR_TYPES.includes(payload.type) || !["REAL", "SIMULATED"].includes(payload.source)) return;
      if (!(await this.monitoring.ingest(payload, match[1]))) this.logger.warn(`MQTT message rejected for ${match[1]}`);
    } catch (error) {
      this.logger.warn(`MQTT message rejected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
