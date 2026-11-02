import { EntityManager } from '@mikro-orm/core';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { User } from '../dal/entity/user.entity';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwt: JwtService;
  let users: User[];

  const userRepository = {
    findOne: jest.fn(({ username }: { username: string }) =>
      Promise.resolve(users.find((u) => u.username === username) ?? null),
    ),
    findOneOrFail: jest.fn((where: { id?: number; username?: string }) => {
      const user = users.find((u) =>
        where.id != null ? u.id === where.id : u.username === where.username,
      );
      return user ? Promise.resolve(user) : Promise.reject(new Error('404'));
    }),
    create: jest.fn((data: Partial<User>) => ({ id: 99, ...data }) as User),
  };
  const em = {
    persistAndFlush: jest.fn((user: User) => {
      if (!users.includes(user)) users.push(user);
      return Promise.resolve();
    }),
    removeAndFlush: jest.fn(),
  };

  const addUser = async (username: string, password: string) => {
    const user = {
      id: users.length + 1,
      username,
      password: await bcrypt.hash(password, 4),
    } as User;
    users.push(user);
    return user;
  };

  beforeEach(async () => {
    users = [];
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'dummyaccesstoken' })],
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: EntityManager, useValue: em },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwt = module.get<JwtService>(JwtService);
  });

  it('registers with a username, stored trimmed and lowercase', async () => {
    const token = await service.register('  Emilie ', 'Password123');

    expect(users).toHaveLength(1);
    expect(users[0].username).toBe('emilie');
    const payload = await jwt.verifyAsync(token);
    expect(payload).toMatchObject({ userId: 99, username: 'emilie' });
  });

  it('refuses a username that is already taken', async () => {
    await addUser('emilie', 'Password123');

    await expect(service.register('EMILIE', 'Password123')).rejects.toThrow();
    expect(await service.isUsernameTaken('Emilie')).toBe(true);
    expect(await service.isUsernameTaken('partner')).toBe(false);
  });

  it('does not count your own username as taken', async () => {
    const user = await addUser('emilie', 'Password123');

    expect(await service.isUsernameTaken('emilie', user.id)).toBe(false);
  });

  it('signs in by username, ignoring case', async () => {
    await addUser('emilie', 'Password123');

    const payload = await jwt.verifyAsync(
      await service.signIn('Emilie', 'Password123'),
    );
    expect(payload.username).toBe('emilie');
    await expect(service.signIn('emilie', 'wrong')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('changes the password only when the current one is right', async () => {
    const user = await addUser('emilie', 'Password123');

    await expect(
      service.changePassword(user.id, 'wrong', 'NewPassword123'),
    ).rejects.toThrow(UnauthorizedException);

    const token = await service.changePassword(
      user.id,
      'Password123',
      'NewPassword123',
    );
    expect(await bcrypt.compare('NewPassword123', user.password)).toBe(true);
    // The new token carries the new password fingerprint, so it stays valid
    await expect(
      service.verifyPwf(await jwt.verifyAsync(token)),
    ).resolves.toBeUndefined();
  });

  it('changes the username', async () => {
    const user = await addUser('emilie', 'Password123');

    await service.changeUsername(user.id, ' Em ');
    expect(user.username).toBe('em');
  });

  it('resets a password to a random temporary one', async () => {
    const user = await addUser('emilie', 'Password123');

    const temporary = await service.resetPassword('Emilie');

    expect(temporary.length).toBeGreaterThanOrEqual(12);
    expect(await bcrypt.compare(temporary, user.password)).toBe(true);
    expect(await bcrypt.compare('Password123', user.password)).toBe(false);
  });
});
