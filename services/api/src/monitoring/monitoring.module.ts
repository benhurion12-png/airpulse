import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { LocationEntity, ReadingEntity, SensorEntity, UserEntity } from "../database/entities";
import { MonitoringController } from "./monitoring.controller";
import { MonitoringService } from "./monitoring.service";
import { MqttIngestService } from "./mqtt-ingest.service";

@Module({
  imports: [TypeOrmModule.forFeature([LocationEntity, SensorEntity, ReadingEntity, UserEntity]), AuthModule],
  controllers: [MonitoringController],
  providers: [MonitoringService, MqttIngestService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
