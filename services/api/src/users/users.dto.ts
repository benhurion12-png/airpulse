import { IsBoolean, IsIn } from "class-validator";
import { UserRole } from "../database/entities";

export class UpdateRoleDto {
  @IsIn(["CLIENT", "OPERATOR", "ADMIN"])
  role: UserRole;
}

export class UpdateActiveDto {
  @IsBoolean()
  isActive: boolean;
}
