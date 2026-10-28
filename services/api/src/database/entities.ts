import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from "typeorm";

export type UserRole = "CLIENT" | "OPERATOR" | "ADMIN";
export type SensorMode = "SIMULATED" | "REAL";
export type SensorType = "CH4" | "NO2" | "PM2.5" | "SO2" | "PM10" | "CO" | "CO2" | "MQ2";

@Entity({ name: "users" })
export class UserEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id: string;

  @Column({ type: "varchar", length: 120 })
  name: string;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 180, unique: true })
  email: string;

  @Column({ name: "password_hash", type: "varchar", length: 255 })
  passwordHash: string;

  @Index()
  @Column({ type: "varchar", length: 16, default: "CLIENT" })
  role: UserRole;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt: Date;
}

@Entity({ name: "locations" })
export class LocationEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id: string;

  @Column({ type: "varchar", length: 120, unique: true })
  name: string;

  @Column({ type: "varchar", length: 100 })
  city: string;

  @Column({ type: "varchar", length: 180, default: "" })
  address: string;

  @Column({ type: "double precision" })
  latitude: number;

  @Column({ type: "double precision" })
  longitude: number;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @OneToMany(() => SensorEntity, (sensor) => sensor.location)
  sensors: SensorEntity[];
}

@Entity({ name: "sensors" })
export class SensorEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id: string;

  @Column({ type: "varchar", length: 120 })
  name: string;

  @Index()
  @Column({ type: "varchar", length: 16 })
  type: SensorType;

  @Column({ type: "varchar", length: 16, default: "SIMULATED" })
  mode: SensorMode;

  @Column({ type: "varchar", length: 16 })
  unit: string;

  @Index()
  @Column({ name: "location_id", type: "varchar", length: 36 })
  locationId: string;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive: boolean;

  @Column({ name: "last_seen", type: "timestamptz", nullable: true })
  lastSeen: Date | null;

  @Column({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(() => LocationEntity, (location) => location.sensors, { onDelete: "CASCADE" })
  @JoinColumn({ name: "location_id" })
  location: LocationEntity;

  @OneToMany(() => ReadingEntity, (reading) => reading.sensor)
  readings: ReadingEntity[];
}

@Entity({ name: "readings" })
@Index("ix_readings_location_time", ["locationId", "measuredAt"])
export class ReadingEntity {
  @PrimaryColumn({ type: "varchar", length: 36 })
  id: string;

  @Index()
  @Column({ name: "sensor_id", type: "varchar", length: 64 })
  sensorId: string;

  @Index()
  @Column({ name: "location_id", type: "varchar", length: 36 })
  locationId: string;

  @Index()
  @Column({ type: "varchar", length: 16 })
  type: SensorType;

  @Column({ type: "double precision" })
  value: number;

  @Column({ type: "varchar", length: 16 })
  unit: string;

  @Column({ type: "varchar", length: 16, default: "SIMULATED" })
  source: string;

  @Index()
  @Column({ name: "measured_at", type: "timestamptz" })
  measuredAt: Date;

  @ManyToOne(() => SensorEntity, (sensor) => sensor.readings, { onDelete: "CASCADE" })
  @JoinColumn({ name: "sensor_id" })
  sensor: SensorEntity;
}

export const ENTITIES = [UserEntity, LocationEntity, SensorEntity, ReadingEntity];
