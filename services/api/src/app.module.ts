import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "./auth/auth.module";
import { BootstrapModule } from "./bootstrap/bootstrap.module";
import { ENTITIES } from "./database/entities";
import { MonitoringModule } from "./monitoring/monitoring.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres" as const,
        url: normalizeDatabaseUrl(config.get<string>("DATABASE_URL") ?? "postgresql://airpulse:airpulse-local-only@localhost:5436/airpulse"),
        entities: ENTITIES,
        synchronize: (config.get<string>("DB_SYNCHRONIZE") ?? "true").toLowerCase() === "true",
        logging: false,
        retryAttempts: 20,
        retryDelay: 2_000,
      }),
    }),
    AuthModule,
    UsersModule,
    MonitoringModule,
    BootstrapModule,
  ],
})
export class AppModule {}

function normalizeDatabaseUrl(url: string) {
  return url.replace("postgresql+psycopg://", "postgresql://");
}
