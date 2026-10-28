import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { Repository } from "typeorm";
import { hashPassword } from "../auth/password";
import { LocationEntity, ReadingEntity, SensorEntity, SensorType, UserEntity } from "../database/entities";
import { UNITS } from "../monitoring/quality";

const LOCATIONS: [string, string, string, number, number][] = [
  ["Северный промышленный узел", "Петропавловск", "ул. Индустриальная, 12", 54.9158, 69.1504],
  ["Элеватор Тайынша", "Тайынша", "Промышленная зона", 53.8478, 69.7639],
  ["Складской комплекс Булаево", "Булаево", "ул. Железнодорожная, 18", 54.9056, 70.4439],
  ["Сергеевский энергоузел", "Сергеевка", "Энергетический проезд, 4", 53.8814, 67.4158],
];
const BASELINES: Record<SensorType, number> = { CH4: 720, NO2: 34, "PM2.5": 19, SO2: 28, PM10: 42, CO: 2.1, CO2: 610, MQ2: 240 };
const SENSOR_TYPES = Object.keys(UNITS) as SensorType[];

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(LocationEntity) private readonly locations: Repository<LocationEntity>,
    @InjectRepository(SensorEntity) private readonly sensors: Repository<SensorEntity>,
    @InjectRepository(ReadingEntity) private readonly readings: Repository<ReadingEntity>,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    await this.seedAdmin();
    await this.seedDemo();
  }

  private async seedAdmin() {
    const email = (this.config.get<string>("ADMIN_EMAIL") ?? "admin@airpulse.local").trim().toLowerCase();
    if (await this.users.findOne({ where: { email } })) return;
    await this.users.save(this.users.create({
      id: randomUUID(),
      name: (this.config.get<string>("ADMIN_NAME") ?? "Администратор AirPulse").trim() || "Администратор AirPulse",
      email,
      passwordHash: await hashPassword(this.config.get<string>("ADMIN_PASSWORD") ?? "ChangeMe123!"),
      role: "ADMIN",
      isActive: true,
      createdAt: new Date(),
    }));
    this.logger.log(`Created initial administrator ${email}`);
  }

  private async seedDemo() {
    if (await this.locations.count()) return;
    const random = seededRandom(2409);
    for (let locationIndex = 0; locationIndex < LOCATIONS.length; locationIndex += 1) {
      const [name, city, address, latitude, longitude] = LOCATIONS[locationIndex];
      const location = await this.locations.save(this.locations.create({ id: randomUUID(), name, city, address, latitude, longitude, createdAt: new Date() }));
      const chosen = locationIndex === 3 ? ["PM2.5" as SensorType] : SENSOR_TYPES.slice(locationIndex, locationIndex + 5);
      for (let sensorIndex = 0; sensorIndex < chosen.length; sensorIndex += 1) {
        const type = chosen[sensorIndex];
        const id = `sko-${locationIndex + 1}-${type.toLowerCase().replace(".", "")}-${sensorIndex + 1}`;
        const sensor = await this.sensors.save(this.sensors.create({
          id,
          name: `${type} · ${city}`,
          type,
          mode: "SIMULATED",
          unit: UNITS[type],
          locationId: location.id,
          isActive: true,
          lastSeen: new Date(),
          createdAt: new Date(),
        }));
        const baseline = BASELINES[type] * (0.82 + locationIndex * 0.09);
        const values: ReadingEntity[] = [];
        for (let step = 0; step < 96; step += 1) {
          const daily = Math.sin(step / 7.5 + locationIndex) * baseline * 0.09;
          const trend = (step / 95) * baseline * (locationIndex === 1 ? 0.035 : -0.012);
          const noise = gaussian(random) * baseline * 0.035;
          values.push(this.readings.create({
            id: randomUUID(),
            sensorId: sensor.id,
            locationId: location.id,
            type,
            value: Math.max(0, baseline + daily + trend + noise),
            unit: UNITS[type],
            source: "SEED",
            measuredAt: new Date(Date.now() - (95 - step) * 30 * 60_000),
          }));
        }
        await this.readings.insert(values);
      }
    }
    this.logger.log("Created demo locations and 48 hours of readings");
  }
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function gaussian(random: () => number): number {
  const left = Math.max(random(), Number.EPSILON);
  const right = random();
  return Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
}
