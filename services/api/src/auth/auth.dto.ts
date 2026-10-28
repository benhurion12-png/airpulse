import { Transform } from "class-transformer";
import { IsEmail, IsString, Length, Matches, MaxLength, MinLength } from "class-validator";

const normalizeEmail = ({ value }: { value: unknown }) => String(value ?? "").trim().toLowerCase();

export class RegisterDto {
  @Transform(({ value }) => String(value ?? "").trim().replace(/\s+/g, " "))
  @IsString()
  @Length(2, 120)
  name: string;

  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(180)
  email: string;

  @IsString()
  @Length(8, 128)
  @Matches(/\p{L}/u, { message: "Пароль должен содержать хотя бы одну букву" })
  @Matches(/\d/, { message: "Пароль должен содержать хотя бы одну цифру" })
  password: string;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(180)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @IsString()
  @Length(20, 4096)
  refreshToken: string;
}
