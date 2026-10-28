import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import { Response } from "express";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;
    let detail = "Внутренняя ошибка сервера";
    if (typeof body === "string") detail = body;
    else if (body && typeof body === "object") {
      const payload = body as { detail?: string; message?: string | string[] };
      if (payload.detail) detail = payload.detail;
      else if (Array.isArray(payload.message)) detail = payload.message.join(". ");
      else if (payload.message) detail = payload.message;
    }
    if (status >= 500) console.error(exception);
    response.status(status).json({ detail });
  }
}
