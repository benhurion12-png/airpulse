import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { AuthenticatedRequest, JwtAuthGuard } from "./auth.guards";
import { LoginDto, RefreshDto, RegisterDto } from "./auth.dto";
import { AuthService, serializeUser } from "./auth.service";

@Controller("api/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() body: RegisterDto) {
    return this.auth.register(body);
  }

  @Post("login")
  login(@Body() body: LoginDto) {
    return this.auth.login(body);
  }

  @Post("refresh")
  refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body.refreshToken);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return serializeUser(request.user!);
  }
}
