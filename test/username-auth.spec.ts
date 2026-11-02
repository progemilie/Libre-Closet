import { test, expect, type Page } from '@playwright/test';

/**
 * Accounts use a username instead of an email address.
 * Needs AUTH_ENABLED=true; skipped otherwise (the CI smoke run has auth off).
 */

const stamp = Date.now();
const PASSWORD = 'TestPass123';
const NEW_PASSWORD = 'NewPass456';
const username = `user${stamp}`;
const renamed = `renamed${stamp}`;

test.describe.configure({ mode: 'serial' });

/** Fill a live-validated form one field at a time, letting each re-render settle. */
async function fillLive(page: Page, fields: [string, string][]) {
  for (const [field, value] of fields) {
    await page.fill(`input[name=${field}]`, value);
    await page.locator(`input[name=${field}]`).press('Tab');
    await page.waitForTimeout(1500);
  }
}

async function login(page: Page, name: string, password: string) {
  await page.goto('/auth/login');
  await page.fill('input[name=username]', name);
  await page.fill('input[name=password]', password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText('Logout').first()).toBeVisible();
}

test.beforeAll(async ({ request }) => {
  // /auth/profile is 404 when accounts are off (401 when on, logged out)
  const res = await request.get('/auth/profile');
  test.skip(res.status() === 404, 'AUTH_ENABLED is off');
});

test('register with a username, no email needed', async ({ page }) => {
  await page.goto('/auth/register');
  await expect(page.locator('input[type=email]')).toHaveCount(0);
  await fillLive(page, [
    ['username', username],
    ['password', PASSWORD],
    ['confirmPassword', PASSWORD],
  ]);
  await page.locator('#submit').click();
  await expect(page.getByText('Logout').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: username })).toBeVisible();
});

test('a taken username is rejected while typing', async ({ page }) => {
  await page.goto('/auth/register');
  await fillLive(page, [['username', username.toUpperCase()]]);
  await expect(page.getByText('This username is already taken')).toBeVisible();
});

test('log in with the username, in any case', async ({ page }) => {
  await login(page, username.toUpperCase(), PASSWORD);
  await expect(page.getByRole('heading', { name: username })).toBeVisible();
});

test('change password from the profile', async ({ page }) => {
  await login(page, username, PASSWORD);
  await page.getByRole('link', { name: 'Change Password' }).click();
  await fillLive(page, [
    ['currentPassword', PASSWORD],
    ['newPassword', NEW_PASSWORD],
    ['confirmPassword', NEW_PASSWORD],
  ]);
  await page.locator('#submit').click();
  // Still logged in after the change
  await expect(page.getByRole('heading', { name: username })).toBeVisible();

  await page.goto('/auth/logout');
  await login(page, username, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: username })).toBeVisible();
});

test('a wrong current password does not change it', async ({ page }) => {
  await login(page, username, NEW_PASSWORD);
  await page.goto('/auth/change-password');
  await fillLive(page, [
    ['currentPassword', 'NotMyPass1'],
    ['newPassword', PASSWORD],
    ['confirmPassword', PASSWORD],
  ]);
  await page.locator('#submit').click();
  await expect(page.getByText('Current password is incorrect')).toBeVisible();
});

test('change username from the profile', async ({ page }) => {
  await login(page, username, NEW_PASSWORD);
  await page.getByRole('link', { name: 'Change Username' }).click();
  await fillLive(page, [['username', renamed]]);
  await page.locator('#submit').click();
  await expect(page.getByRole('heading', { name: renamed })).toBeVisible();

  await page.goto('/auth/logout');
  await login(page, renamed, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: renamed })).toBeVisible();
});
