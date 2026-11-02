import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Redirect,
  Render,
  Res,
  UseGuards,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import type { FastifyReply } from 'fastify';
import { I18n, I18nContext } from 'nestjs-i18n';
import { AuthGuard } from './auth.guard';
import { RegistrationGuard } from './registration.guard';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/changePassword.dto';
import { LoginDto } from './dto/login.dto';
import { Payload } from './dto/payload.dto';
import { RegisterDto } from './dto/register.dto';
import { User } from './user.decorator';
import { UpdateUsernameDto } from './dto/updateUsername.dto';
import { seconds, Throttle } from '@nestjs/throttler';

const ACCESS_TOKEN_COOKIE = {
  path: '/',
  maxAge: 365 * 24 * 60 * 60 * 1000, // 365 days
  httpOnly: true, // Prevents client-side JS from reading it
};

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private authService: AuthService) {}

  /** Validates the DTO, and that no other account has its `username`. */
  private async validateWithUsername(
    i18n: I18nContext,
    instance: RegisterDto | UpdateUsernameDto,
    exceptUserId?: number,
  ) {
    const validationErrors = await i18n.validate(instance);
    if (
      !validationErrors.some((e) => e.property === 'username') &&
      (await this.authService.isUsernameTaken(instance.username, exceptUserId))
    ) {
      validationErrors.push({
        property: 'username',
        constraints: { taken: i18n.t('lang.validation.USERNAME_TAKEN') },
      });
    }
    return validationErrors;
  }

  @UseGuards(RegistrationGuard)
  @Post('register')
  async postRegister(
    @I18n() i18n: I18nContext,
    @Body() body: RegisterDto,
    @Res() reply: FastifyReply,
  ): Promise<any> {
    const instance = plainToInstance(RegisterDto, body);
    const validationErrors = await this.validateWithUsername(i18n, instance);
    if (validationErrors.length) {
      return reply.view('auth/register', {
        layout: 'layout',
        input: body,
        validationErrors,
        ...((reply as any).locals ?? {}),
      });
    }

    const jwt = await this.authService.register(
      instance.username,
      instance.password,
    );
    reply.setCookie('access_token', jwt, ACCESS_TOKEN_COOKIE);
    return reply.redirect('/auth/profile', 302);
  }

  @UseGuards(RegistrationGuard)
  @Render('auth/register')
  @Post('validate/register')
  async postRegisterValidate(
    @I18n() i18n: I18nContext,
    @Body() body: RegisterDto,
  ) {
    const instance = plainToInstance(RegisterDto, body);
    const validationErrors = await this.validateWithUsername(i18n, instance);
    if (validationErrors.length) {
      return {
        input: body,
        validationErrors,
      };
    }

    return { input: body };
  }

  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @Post('login')
  async postLogin(@Body() loginDto: LoginDto, @Res() reply: FastifyReply) {
    try {
      const jwt = await this.authService.signIn(
        loginDto.username,
        loginDto.password,
      );
      reply.setCookie('access_token', jwt, ACCESS_TOKEN_COOKIE);
      reply.redirect('/auth/profile', 302);
    } catch (error) {
      this.logger.warn(error);
      return reply.view('auth/login', {
        layout: 'layout',
        error,
        ...((reply as any).locals ?? {}),
      });
    }
  }

  @Redirect('/')
  @Get('logout')
  getLogout(
    // https://docs.nestjs.com/techniques/cookies#use-with-express-default
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.clearCookie('access_token', { path: '/' });
  }

  @Get('login')
  @Render('auth/login')
  getLogin(@I18n() i18n: I18nContext): any {
    return {
      ogTitle: i18n.t('lang.LOGIN_OG_TITLE'),
      ogDescription: i18n.t('lang.LOGIN_OG_DESC'),
    };
  }

  @UseGuards(RegistrationGuard)
  @Get('register')
  @Render('auth/register')
  getRegister(@I18n() i18n: I18nContext): any {
    return {
      ogTitle: i18n.t('lang.REGISTER_OG_TITLE'),
      ogDescription: i18n.t('lang.REGISTER_OG_DESC'),
    };
  }

  @UseGuards(AuthGuard)
  @Get('profile')
  @Render('auth/profile')
  getProfile(): any {}

  @UseGuards(AuthGuard)
  @Get('delete-account')
  @Render('auth/delete-account')
  getDeleteAccount(): any {}

  @UseGuards(AuthGuard)
  @Post('delete-account')
  async postDeleteAccount(
    @User() payload: Payload,
    @Body() loginDto: LoginDto,
    @Res() reply: FastifyReply,
  ) {
    try {
      await this.authService.signIn(loginDto.username, loginDto.password);
      await this.authService.deleteUser(payload.userId);
      reply.clearCookie('access_token', { path: '/' });
      return reply.redirect('/', 302);
    } catch (error) {
      this.logger.warn(error);
      return reply.view('auth/delete-account', {
        layout: 'layout',
        error,
        ...((reply as any).locals ?? {}),
      });
    }
  }

  @UseGuards(AuthGuard)
  @Get('update-username')
  @Render('auth/update-username')
  getUpdateUsername() {}

  @UseGuards(AuthGuard)
  @Render('auth/update-username')
  @Post('validate/update-username')
  async postValidateUpdateUsername(
    @User() payload: Payload,
    @I18n() i18n: I18nContext,
    @Body() body: UpdateUsernameDto,
  ) {
    const instance = plainToInstance(UpdateUsernameDto, body);
    const validationErrors = await this.validateWithUsername(
      i18n,
      instance,
      payload.userId,
    );
    if (validationErrors.length) {
      return {
        input: body,
        validationErrors,
      };
    }

    return { input: body };
  }

  @UseGuards(AuthGuard)
  @Post('update-username')
  async postUpdateUsername(
    @User() payload: Payload,
    @I18n() i18n: I18nContext,
    @Body() body: UpdateUsernameDto,
    @Res() reply: FastifyReply,
  ) {
    const instance = plainToInstance(UpdateUsernameDto, body);
    const validationErrors = await this.validateWithUsername(
      i18n,
      instance,
      payload.userId,
    );
    if (validationErrors.length) {
      return reply.view('auth/update-username', {
        layout: 'layout',
        input: body,
        validationErrors,
        ...((reply as any).locals ?? {}),
      });
    }

    await this.authService.changeUsername(payload.userId, instance.username);
    return reply.redirect('/auth/profile', 302);
  }

  @UseGuards(AuthGuard)
  @Get('change-password')
  @Render('auth/change-password')
  getChangePassword() {}

  @UseGuards(AuthGuard)
  @Render('auth/change-password')
  @Post('validate/change-password')
  async postValidateChangePassword(
    @I18n() i18n: I18nContext,
    @Body() body: ChangePasswordDto,
  ) {
    const instance = plainToInstance(ChangePasswordDto, body);
    const validationErrors = await i18n.validate(instance);
    if (validationErrors.length) {
      return {
        input: body,
        validationErrors,
      };
    }

    return { input: body };
  }

  @Throttle({ default: { limit: 5, ttl: seconds(60) } })
  @UseGuards(AuthGuard)
  @Post('change-password')
  async postChangePassword(
    @User() payload: Payload,
    @I18n() i18n: I18nContext,
    @Body() body: ChangePasswordDto,
    @Res() reply: FastifyReply,
  ) {
    const instance = plainToInstance(ChangePasswordDto, body);
    const validationErrors: object[] = await i18n.validate(instance);
    if (!validationErrors.length) {
      try {
        const jwt = await this.authService.changePassword(
          payload.userId,
          instance.currentPassword,
          instance.newPassword,
        );
        reply.setCookie('access_token', jwt, ACCESS_TOKEN_COOKIE);
        return reply.redirect('/auth/profile', 302);
      } catch (error) {
        this.logger.warn(error);
        validationErrors.push({
          property: 'currentPassword',
          constraints: {
            wrong: i18n.t('lang.validation.WRONG_CURRENT_PASSWORD'),
          },
        });
      }
    }

    return reply.view('auth/change-password', {
      layout: 'layout',
      input: body,
      validationErrors,
      ...((reply as any).locals ?? {}),
    });
  }
}
