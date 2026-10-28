import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LocationEntity, ReadingEntity, SensorEntity, UserEntity } from "../database/entities";
import { BootstrapService } from "./bootstrap.service";

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, LocationEntity, SensorEntity, ReadingEntity])],
  providers: [BootstrapService],
})
export class BootstrapModule {}
