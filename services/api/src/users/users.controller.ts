import { Body, Controller, Get, NotFoundException, Param, Patch, Req, UnprocessableEntityException, UseGuards } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuthenticatedRequest, JwtAuthGuard, Roles, RolesGuard } from "../auth/auth.guards";
import { serializeUser } from "../auth/auth.service";
import { UserEntity } from "../database/entities";
import { UpdateActiveDto, UpdateRoleDto } from "./users.dto";

@Controller("api/users")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class UsersController {
  constructor(@InjectRepository(UserEntity) private readonly users: Repository<UserEntity>) {}

  @Get()
  async list() {
    return (await this.users.find({ order: { createdAt: "DESC" } })).map(serializeUser);
  }

  @Patch(":id/role")
  async updateRole(@Param("id") id: string, @Body() body: UpdateRoleDto, @Req() request: AuthenticatedRequest) {
    const user = await this.find(id);
    if (user.id === request.user!.id && body.role !== "ADMIN") {
      throw new UnprocessableEntityException({ detail: "Нельзя снять роль администратора у самого себя" });
    }
    user.role = body.role;
    return serializeUser(await this.users.save(user));
  }

  @Patch(":id/active")
  async updateActive(@Param("id") id: string, @Body() body: UpdateActiveDto, @Req() request: AuthenticatedRequest) {
    const user = await this.find(id);
    if (user.id === request.user!.id && !body.isActive) {
      throw new UnprocessableEntityException({ detail: "Нельзя отключить собственную учётную запись" });
    }
    user.isActive = body.isActive;
    return serializeUser(await this.users.save(user));
  }

  private async find(id: string) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException({ detail: "Пользователь не найден" });
    return user;
  }
}
