import { Type } from "class-transformer";
import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from "class-validator";
import { SensorMode, SensorType } from "../database/entities";

export const SENSOR_TYPES: SensorType[] = ["CH4", "NO2", "PM2.5", "SO2", "PM10", "CO", "CO2", "MQ2"];

export class CreateLocationDto {
  @IsString()
  @Length(2, 120)
  name: string;

  @IsString()
  @Length(2, 100)
  city: string;

  @IsString()
  @MaxLength(180)
  address = "";

  @Type(() => Number)
  @IsNumber()
  @Min(52.7)
  @Max(56)
  latitude: number;

  @Type(() => Number)
  @IsNumber()
  @Min(65.5)
  @Max(72.5)
  longitude: number;
}

export class CreateSensorDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,64}$/)
  id: string;

  @IsString()
  @Length(2, 120)
  name: string;

  @IsIn(SENSOR_TYPES)
  type: SensorType;

  @IsIn(["SIMULATED", "REAL"])
  mode: SensorMode = "SIMULATED";

  @IsString()
  location_id: string;
}

export class TelemetryDto {
  @Matches(/^[A-Za-z0-9_-]{3,64}$/)
  deviceId: string;

  @IsIn(SENSOR_TYPES)
  type: SensorType;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  value: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsIn(["REAL", "SIMULATED"])
  source: "REAL" | "SIMULATED" = "REAL";

  @IsOptional()
  @IsISO8601()
  measuredAt?: string;
}
