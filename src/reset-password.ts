import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';

/**
 * Forgotten password: `npm run reset-password -- <username>` sets a random
 * temporary password and prints it. Run it where the app runs, e.g.
 * `docker compose exec libre-closet npm run reset-password -- <username>`.
 */
async function resetPassword() {
  const username = process.argv[2];
  if (!username) {
    console.error('Usage: npm run reset-password -- <username>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    const temporaryPassword = await app
      .get(AuthService)
      .resetPassword(username);
    console.log(
      `Temporary password for ${username}: ${temporaryPassword}\n` +
        'Log in with it, then choose a new one under Profile > Change Password.',
    );
  } catch {
    console.error(`No user named ${username}.`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void resetPassword();
