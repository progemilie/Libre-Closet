import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '../dal/entity/user.entity';
import * as bcrypt from 'bcryptjs';
import { Payload } from './dto/payload.dto';
import { randomBytes } from 'crypto';
import { normalizeUsername } from './credentials.validators';

@Injectable()
export class AuthService {
  private logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: EntityRepository<User>,
    private jwtService: JwtService,
    private readonly em: EntityManager,
  ) {}

  async register(username: string, password: string): Promise<string> {
    this.logger.debug(this.register.name);
    username = normalizeUsername(username);
    if (await this.isUsernameTaken(username)) {
      this.logger.debug(`User already exists with username: ${username}`);
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = this.userRepository.create({
      username,
      password: hashedPassword,
    } as User);
    await this.em.persistAndFlush(user);

    return this.signToken(user);
  }

  /** Whether another account (not `exceptUserId`) already uses this username. */
  async isUsernameTaken(
    username: string,
    exceptUserId?: number,
  ): Promise<boolean> {
    const user = await this.userRepository.findOne({
      username: normalizeUsername(username),
    });
    return !!user && user.id !== exceptUserId;
  }

  async signIn(username: string, password: string): Promise<string> {
    const user = await this.userRepository.findOneOrFail({
      username: normalizeUsername(username),
    });
    const valid = await bcrypt.compare(password, user?.password);
    if (!valid) {
      throw new UnauthorizedException();
    }
    return this.signToken(user);
  }

  private signToken(user: User): Promise<string> {
    return this.jwtService.signAsync({
      userId: user.id,
      username: user.username,
      pwf: user.password.slice(-8),
    } as Payload);
  }

  public async verifyPwf(payload: Payload) {
    // Verify password fingerprint, tokens invalidate on password change or if missing
    const user = await this.userRepository.findOneOrFail({
      id: payload.userId,
    });
    if (user.password.slice(-8) !== payload.pwf) {
      throw new UnauthorizedException();
    }
  }

  /** Returns a new token, as the password change invalidates the old one. */
  public async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
  ): Promise<string> {
    this.logger.debug(this.changePassword.name);
    const user = await this.userRepository.findOneOrFail({ id: userId });
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      throw new UnauthorizedException();
    }
    user.password = await bcrypt.hash(newPassword, 12);
    await this.em.persistAndFlush(user);
    return this.signToken(user);
  }

  public async changeUsername(userId: number, username: string) {
    const user = await this.userRepository.findOneOrFail({ id: userId });
    user.username = normalizeUsername(username);
    await this.em.persistAndFlush(user);
  }

  async deleteUser(userId: any) {
    const user = await this.userRepository.findOneOrFail({ id: userId });
    await this.em.removeAndFlush(user);
  }

  /** For a forgotten password: sets and returns a random temporary one. */
  public async resetPassword(username: string): Promise<string> {
    this.logger.debug(this.resetPassword.name);
    const user = await this.userRepository.findOneOrFail({
      username: normalizeUsername(username),
    });
    const temporaryPassword = randomBytes(12).toString('base64url');
    user.password = await bcrypt.hash(temporaryPassword, 12);
    await this.em.persistAndFlush(user);
    return temporaryPassword;
  }
}
