import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { InjectRepository } from "@nestjs/typeorm";
import { Request } from "express";
import { Repository } from "typeorm";
import { UserEntity, UserRole } from "../database/entities";
import { AuthService } from "./auth.service";
import { safeSecretEqual } from "./password";

export type AuthenticatedRequest = Request & { user?: UserEntity };
export const ROLES_KEY = "airpulse_roles";
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.toLowerCase().startsWith("bearer ")) {
      throw new UnauthorizedException({ detail: "Войдите в систему" });
    }
    const payload = await this.auth.verifyToken(authorization.slice(7).trim(), "access");
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user?.isActive) throw new UnauthorizedException({ detail: "Пользователь не найден или отключён" });
    request.user = user;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]) ?? [];
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user || !expected.includes(user.role)) throw new ForbiddenException({ detail: "Недостаточно прав" });
    return true;
  }
}

@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly jwtGuard: JwtAuthGuard,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (safeSecretEqual(headerValue(request.headers["x-admin-key"]), this.config.get<string>("ADMIN_KEY") ?? "airpulse-admin")) return true;
    await this.jwtGuard.canActivate(context);
    if (!request.user || !["OPERATOR", "ADMIN"].includes(request.user.role)) {
      throw new ForbiddenException({ detail: "Нужна роль оператора или администратора" });
    }
    return true;
  }
}

@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!safeSecretEqual(headerValue(request.headers["x-admin-key"]), this.config.get<string>("ADMIN_KEY") ?? "airpulse-admin")) {
      throw new ForbiddenException({ detail: "Нужен служебный ключ" });
    }
    return true;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
