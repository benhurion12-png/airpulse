import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { MoreThanOrEqual, Repository } from "typeorm";
import { LocationEntity, ReadingEntity, SensorEntity, SensorMode, SensorType } from "../database/entities";
import { CreateLocationDto, CreateSensorDto, TelemetryDto } from "./monitoring.dto";
import { combinedQuality, forecastQuality, parameterQuality, qualityLabel, UNITS } from "./quality";

@Injectable()
export class MonitoringService {
  constructor(
    @InjectRepository(LocationEntity) private readonly locationsRepository: Repository<LocationEntity>,
    @InjectRepository(SensorEntity) private readonly sensorsRepository: Repository<SensorEntity>,
    @InjectRepository(ReadingEntity) private readonly readingsRepository: Repository<ReadingEntity>,
  ) {}

  async health() {
    await this.locationsRepository.count();
    return { status: "ok", service: "airpulse-nest-api", time: new Date().toISOString() };
  }

  async dashboard() {
    const locations = await Promise.all((await this.locationEntities()).map((item) => this.locationView(item, true)));
    const scores = locations.map((item) => item.score).filter((score): score is number => score !== null);
    const sensors = locations.flatMap((item) => item.sensors);
    return {
      region: "Северо-Казахстанская область",
      updatedAt: new Date().toISOString(),
      overallScore: scores.length ? round(scores.reduce((sum, score) => sum + score, 0) / scores.length, 1) : null,
      onlineSensors: sensors.filter((sensor) => sensor.online).length,
      totalSensors: sensors.length,
      locations,
    };
  }

  async locations() {
    return Promise.all((await this.locationEntities()).map((item) => this.locationView(item, false)));
  }

  async createLocation(body: CreateLocationDto) {
    const location = this.locationsRepository.create({
      id: randomUUID(),
      name: body.name,
      city: body.city,
      address: body.address,
      latitude: body.latitude,
      longitude: body.longitude,
      createdAt: new Date(),
      sensors: [],
    });
    try {
      await this.locationsRepository.save(location);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException({ detail: "Объект с таким названием уже существует" });
      throw error;
    }
    return this.locationView(location, false);
  }

  async history(locationId: string, hours: number) {
    await this.requireLocation(locationId);
    const rows = await this.readingsRepository.find({
      where: { locationId, measuredAt: MoreThanOrEqual(new Date(Date.now() - hours * 3_600_000)) },
      order: { measuredAt: "ASC" },
    });
    const buckets = new Map<string, Map<SensorType, number[]>>();
    rows.forEach((row) => {
      const stamp = new Date(row.measuredAt);
      stamp.setUTCMinutes(Math.floor(stamp.getUTCMinutes() / 30) * 30, 0, 0);
      const key = stamp.toISOString();
      const values = buckets.get(key) ?? new Map<SensorType, number[]>();
      values.set(row.type, [...(values.get(row.type) ?? []), Number(row.value)]);
      buckets.set(key, values);
    });
    const points = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([at, values]) => {
      const averages = [...values.entries()].map(([type, items]) => [type, average(items)] as [SensorType, number]);
      return { at, score: combinedQuality(averages), values: Object.fromEntries(averages.map(([type, value]) => [type, round(value, 2)])) };
    });
    return { locationId, points };
  }

  async forecast(locationId: string, minutes: number) {
    await this.requireLocation(locationId);
    const rows = await this.readingsRepository.find({
      where: { locationId, measuredAt: MoreThanOrEqual(new Date(Date.now() - 48 * 3_600_000)) },
      order: { measuredAt: "ASC" },
    });
    return forecastQuality(rows, minutes);
  }

  async sensors() {
    const sensors = await this.sensorsRepository.find({ order: { createdAt: "DESC" } });
    return Promise.all(sensors.map((sensor) => this.sensorView(sensor)));
  }

  async createSensor(body: CreateSensorDto) {
    await this.requireLocation(body.location_id);
    if (body.mode === "REAL" && body.type !== "MQ2") {
      throw new UnprocessableEntityException({ detail: "Режим REAL доступен только для MQ-2" });
    }
    const sensor = this.sensorsRepository.create({
      id: body.id,
      name: body.name,
      type: body.type,
      mode: body.mode,
      unit: UNITS[body.type],
      locationId: body.location_id,
      isActive: true,
      lastSeen: null,
      createdAt: new Date(),
    });
    try {
      await this.sensorsRepository.save(sensor);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException({ detail: "ID датчика уже используется" });
      throw error;
    }
    return this.sensorView(sensor);
  }

  async updateSensorMode(sensorId: string, mode: string) {
    const sensor = await this.sensorsRepository.findOne({ where: { id: sensorId } });
    if (!sensor) throw new NotFoundException({ detail: "Датчик не найден" });
    if (!["SIMULATED", "REAL"].includes(mode) || (mode === "REAL" && sensor.type !== "MQ2")) {
      throw new UnprocessableEntityException({ detail: "Режим REAL доступен только для MQ-2" });
    }
    sensor.mode = mode as SensorMode;
    return this.sensorView(await this.sensorsRepository.save(sensor));
  }

  async simulatorSensors() {
    const sensors = await this.sensorsRepository.find({ where: { mode: "SIMULATED", isActive: true } });
    return sensors.map((item) => ({ id: item.id, type: item.type, unit: item.unit, locationId: item.locationId }));
  }

  async ingest(payload: TelemetryDto, topicDeviceId?: string): Promise<boolean> {
    if (topicDeviceId && topicDeviceId !== payload.deviceId) return false;
    if (!payload.deviceId || !Number.isFinite(Number(payload.value)) || Number(payload.value) < 0 || Number(payload.value) > 1_000_000) return false;
    const sensor = await this.sensorsRepository.findOne({ where: { id: payload.deviceId } });
    if (!sensor?.isActive || sensor.type !== payload.type) return false;
    if (sensor.mode === "REAL") {
      if (sensor.type !== "MQ2" || payload.source !== "REAL") return false;
    } else if (payload.source !== "SIMULATED") return false;
    const measuredAt = payload.measuredAt ? new Date(payload.measuredAt) : new Date();
    if (Number.isNaN(measuredAt.getTime())) return false;
    await this.readingsRepository.save(this.readingsRepository.create({
      id: randomUUID(),
      sensorId: sensor.id,
      locationId: sensor.locationId,
      type: sensor.type,
      value: Number(payload.value),
      unit: UNITS[sensor.type],
      source: payload.source,
      measuredAt,
    }));
    sensor.lastSeen = new Date();
    await this.sensorsRepository.save(sensor);
    return true;
  }

  private async locationEntities() {
    const locations = await this.locationsRepository.find({ relations: { sensors: true }, order: { name: "ASC" } });
    locations.forEach((location) => location.sensors.sort((left, right) => left.type.localeCompare(right.type)));
    return locations;
  }

  private async locationView(location: LocationEntity, withForecast: boolean) {
    const sensors = await Promise.all((location.sensors ?? []).map((sensor) => this.sensorView(sensor)));
    const values = sensors
      .filter((sensor) => sensor.isActive && sensor.value !== null)
      .map((sensor) => [sensor.type, sensor.value!] as [SensorType, number]);
    const score = combinedQuality(values);
    let forecast = null;
    if (withForecast) {
      const rows = await this.readingsRepository.find({
        where: { locationId: location.id, measuredAt: MoreThanOrEqual(new Date(Date.now() - 48 * 3_600_000)) },
        order: { measuredAt: "ASC" },
      });
      forecast = forecastQuality(rows);
    }
    return {
      id: location.id,
      name: location.name,
      city: location.city,
      address: location.address,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      score,
      status: qualityLabel(score),
      sensors,
      forecast,
    };
  }

  private async sensorView(sensor: SensorEntity) {
    const latest = await this.readingsRepository.findOne({ where: { sensorId: sensor.id }, order: { measuredAt: "DESC" } });
    const online = Boolean(sensor.lastSeen && new Date(sensor.lastSeen).getTime() >= Date.now() - 5 * 60_000);
    return {
      id: sensor.id,
      name: sensor.name,
      type: sensor.type,
      mode: sensor.mode,
      unit: sensor.unit,
      locationId: sensor.locationId,
      isActive: sensor.isActive,
      online,
      lastSeen: sensor.lastSeen ? new Date(sensor.lastSeen).toISOString() : null,
      value: latest ? round(Number(latest.value), 2) : null,
      quality: latest ? parameterQuality(sensor.type, Number(latest.value)) : null,
    };
  }

  private async requireLocation(id: string) {
    const location = await this.locationsRepository.findOne({ where: { id } });
    if (!location) throw new NotFoundException({ detail: "Объект не найден" });
    return location;
  }
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === "23505");
}
