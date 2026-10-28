import "reflect-metadata";
import { HttpStatus, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { ApiExceptionFilter } from "./common/api-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
  }));
  app.enableCors({
    origin: (config.get<string>("APP_ORIGINS") ?? "http://localhost:3000").split(",").map((item) => item.trim()),
    credentials: true,
  });
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle("AirPulse API")
    .setDescription("NestJS API мониторинга качества воздуха")
    .setVersion("2.0.0")
    .addBearerAuth()
    .build());
  SwaggerModule.setup("docs", app, document);

  await app.listen(Number(config.get("PORT") ?? 8000), "0.0.0.0");
}

void bootstrap();
