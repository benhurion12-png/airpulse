import { Body, Controller, DefaultValuePipe, ForbiddenException, Get, Headers, Param, ParseIntPipe, Patch, Post, Query, UnprocessableEntityException, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AdminKeyGuard, JwtAuthGuard, StaffGuard } from "../auth/auth.guards";
import { safeSecretEqual } from "../auth/password";
import { CreateLocationDto, CreateSensorDto, TelemetryDto } from "./monitoring.dto";
import { MonitoringService } from "./monitoring.service";
import { SCALES } from "./quality";

@Controller("api")
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService, private readonly config: ConfigService) {}

  @Get("health")
  health() {
    return this.monitoring.health();
  }

  @Get("meta")
  meta() {
    return { sensorTypes: Object.entries(SCALES).map(([type, scale]) => ({ type, ...scale })), region: "Северо-Казахстанская область" };
  }

  @Get("dashboard")
  @UseGuards(JwtAuthGuard)
  dashboard() {
    return this.monitoring.dashboard();
  }

  @Get("locations")
  @UseGuards(JwtAuthGuard)
  locations() {
    return this.monitoring.locations();
  }

  @Post("locations")
  @UseGuards(StaffGuard)
  createLocation(@Body() body: CreateLocationDto) {
    return this.monitoring.createLocation(body);
  }

  @Get("locations/:id/history")
  @UseGuards(JwtAuthGuard)
  history(@Param("id") id: string, @Query("hours", new DefaultValuePipe(24), ParseIntPipe) hours: number) {
    if (hours < 1 || hours > 168) throw new UnprocessableEntityException({ detail: "hours должен быть от 1 до 168" });
    return this.monitoring.history(id, hours);
  }

  @Get("locations/:id/forecast")
  @UseGuards(JwtAuthGuard)
  forecast(@Param("id") id: string, @Query("minutes", new DefaultValuePipe(60), ParseIntPipe) minutes: number) {
    if (minutes < 15 || minutes > 360) throw new UnprocessableEntityException({ detail: "minutes должен быть от 15 до 360" });
    return this.monitoring.forecast(id, minutes);
  }

  @Get("sensors")
  @UseGuards(JwtAuthGuard)
  sensors() {
    return this.monitoring.sensors();
  }

  @Post("sensors")
  @UseGuards(StaffGuard)
  createSensor(@Body() body: CreateSensorDto) {
    return this.monitoring.createSensor(body);
  }

  @Patch("sensors/:id/mode")
  @UseGuards(StaffGuard)
  updateSensorMode(@Param("id") id: string, @Query("mode") mode: string) {
    return this.monitoring.updateSensorMode(id, mode);
  }

  @Post("telemetry")
  @UseGuards(AdminKeyGuard)
  async telemetry(@Body() body: TelemetryDto) {
    if (!(await this.monitoring.ingest(body))) throw new UnprocessableEntityException({ detail: "Телеметрия отклонена" });
    return { accepted: true };
  }

  @Get("simulator/sensors")
  simulatorSensors(@Headers("x-simulator-token") token?: string) {
    if (!safeSecretEqual(token, this.config.get<string>("SIMULATOR_TOKEN") ?? "airpulse-simulator")) {
      throw new ForbiddenException({ detail: "Неверный токен симулятора" });
    }
    return this.monitoring.simulatorSensors();
  }
}
