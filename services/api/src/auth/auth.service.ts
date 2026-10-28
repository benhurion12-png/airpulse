import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { Repository } from "typeorm";
import { UserEntity } from "../database/entities";
import { LoginDto, RegisterDto } from "./auth.dto";
import { hashPassword, verifyPassword } from "./password";

type TokenPayload = { sub: string; role: string; type: "access" | "refresh" };

export function serializeUser(user: UserEntity) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(body: RegisterDto) {
    const user = this.users.create({
      id: randomUUID(),
      name: body.name,
      email: body.email,
      passwordHash: await hashPassword(body.password),
      role: "CLIENT",
      isActive: true,
      createdAt: new Date(),
    });
    try {
      await this.users.save(user);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException({ detail: "Пользователь с таким email уже существует" });
      throw error;
    }
    return this.createSession(user);
  }

  async login(body: LoginDto) {
    const user = await this.users.findOne({ where: { email: body.email } });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new UnauthorizedException({ detail: "Неверный email или пароль" });
    }
    if (!user.isActive) throw new UnauthorizedException({ detail: "Учётная запись отключена администратором" });
    return this.createSession(user);
  }

  async refresh(token: string) {
    const payload = await this.verifyToken(token, "refresh");
    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user?.isActive) throw new UnauthorizedException({ detail: "Пользователь не найден или отключён" });
    return this.createSession(user);
  }

  async verifyToken(token: string, expectedType: "access" | "refresh"): Promise<TokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<TokenPayload>(token, { secret: this.secret });
      if (payload.type !== expectedType || !payload.sub) throw new Error("wrong token type");
      return payload;
    } catch {
      throw new UnauthorizedException({ detail: "Некорректный или просроченный токен" });
    }
  }

  private async createSession(user: UserEntity) {
    const accessMinutes = Math.max(5, Number(this.config.get("JWT_ACCESS_MINUTES") ?? 30));
    const refreshDays = Math.max(1, Number(this.config.get("JWT_REFRESH_DAYS") ?? 7));
    const common = { sub: user.id, role: user.role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync({ ...common, type: "access" }, { secret: this.secret, expiresIn: accessMinutes * 60 }),
      this.jwt.signAsync({ ...common, type: "refresh" }, { secret: this.secret, expiresIn: refreshDays * 86_400 }),
    ]);
    return { accessToken, refreshToken, tokenType: "bearer", expiresIn: accessMinutes * 60, user: serializeUser(user) };
  }

  private get secret() {
    return this.config.get<string>("JWT_SECRET") ?? "airpulse-local-jwt-change-me";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === "23505");
}
