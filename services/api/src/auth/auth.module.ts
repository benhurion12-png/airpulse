import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserEntity } from "../database/entities";
import { AuthController } from "./auth.controller";
import { AdminKeyGuard, JwtAuthGuard, RolesGuard, StaffGuard } from "./auth.guards";
import { AuthService } from "./auth.service";

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity]), JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, StaffGuard, AdminKeyGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard, StaffGuard, AdminKeyGuard],
})
export class AuthModule {}
