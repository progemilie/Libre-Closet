import { test, expect, type Page, type Browser } from '@playwright/test';

/**
 * Multiple wardrobes per user, shared one wardrobe at a time.
 * Needs AUTH_ENABLED=true; skipped otherwise (the CI smoke run has auth off).
 */

const stamp = Date.now();
const PASSWORD = 'TestPass123';
const alice = `wardrobes-a-${stamp}@example.com`;
const bob = `wardrobes-b-${stamp}@example.com`;
const PRIVATE_NAME = `Private ${stamp}`;
const JACKET = `Shared Jacket ${stamp}`;
const DIARY = `Private Diary ${stamp}`;

test.describe.configure({ mode: 'serial' });

let alicePage: Page;
let bobPage: Page;

async function register(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/auth/register');
  // Each field is validated live and the form re-rendered; let each settle
  for (const [field, value] of [
    ['email', email],
    ['password', PASSWORD],
    ['confirmPassword', PASSWORD],
  ]) {
    await page.fill(`input[name=${field}]`, value);
    await page.locator(`input[name=${field}]`).press('Tab');
    await page.waitForTimeout(1500);
  }
  await page.locator('#submit').click();
  await expect(page.getByText('Logout').first()).toBeVisible();
  return page;
}

async function addGarment(page: Page, name: string) {
  await page
    .getByRole('link', { name: /New Garment/ })
    .first()
    .click();
  await page.fill('input[name=name]', name);
  await page.fill('input[name=category]', 'top');
  await page.locator('form[action^="/wardrobe"] [type=submit]').click();
  await expect(page).toHaveURL(/\/wardrobe\/\d+/);
  return Number(page.url().match(/\/wardrobe\/(\d+)/)![1]);
}

async function switchWardrobe(page: Page, label: string | RegExp) {
  const switcher = page.locator('#wardrobe-switcher');
  const option = switcher.locator('option', { hasText: label });
  const value = await option.getAttribute('value');
  await Promise.all([
    page.waitForURL(`**${value}`),
    switcher.selectOption(value),
  ]);
}

const wardrobeIdFromUrl = (page: Page) =>
  Number(new URL(page.url()).searchParams.get('wardrobeId'));

let privateWardrobeId: number;
let diaryId: number;

test.beforeAll(async ({ browser, request }) => {
  const res = await request.get('/auth/register');
  test.skip(res.status() === 404, 'AUTH_ENABLED is off');
  alicePage = await register(browser, alice);
  bobPage = await register(browser, bob);
});

test('a new user gets a default wardrobe', async () => {
  await alicePage.goto('/wardrobe');
  await expect(alicePage.locator('h1')).toHaveText('My Wardrobe');
  await addGarment(alicePage, JACKET);
});

test('a user can create a second, private wardrobe', async () => {
  await alicePage.goto('/wardrobes');
  await alicePage.fill(
    'form[action="/wardrobes"] input[name=name]',
    PRIVATE_NAME,
  );
  await alicePage.locator('form[action="/wardrobes"] [type=submit]').click();

  const row = alicePage.locator('li', { hasText: PRIVATE_NAME });
  await expect(row).toBeVisible();
  await expect(row.getByText('Private', { exact: true })).toBeVisible();
});

test('new garments go into the wardrobe being viewed', async () => {
  await alicePage.goto('/wardrobe');
  await switchWardrobe(alicePage, PRIVATE_NAME);
  privateWardrobeId = wardrobeIdFromUrl(alicePage);
  await expect(alicePage.locator('h1')).toHaveText(PRIVATE_NAME);

  diaryId = await addGarment(alicePage, DIARY);
  await alicePage.goto(`/wardrobe?wardrobeId=${privateWardrobeId}`);
  await expect(alicePage.getByText(DIARY)).toBeVisible();
  await expect(alicePage.getByText(JACKET)).toHaveCount(0);
});

test('opening the app shows the default wardrobe, not the private one', async () => {
  await alicePage.goto('/wardrobe');
  await expect(alicePage.locator('h1')).toHaveText('My Wardrobe');
  await expect(alicePage.getByText(JACKET)).toBeVisible();
  await expect(alicePage.getByText(DIARY)).toHaveCount(0);
});

test('sharing one wardrobe does not expose the other', async () => {
  await alicePage.goto('/wardrobe-share/manage');
  const form = alicePage.locator(
    'form[hx-post="/wardrobe-share/create-invite-link"]',
  );
  await form
    .locator('select[name=wardrobeId]')
    .selectOption({ label: 'My Wardrobe' });
  await form.locator('select[name=permission]').selectOption('VIEW');
  await form.locator('[type=submit]').click();
  const inviteUrl = await alicePage
    .locator('#invite-link-result input')
    .inputValue();
  expect(inviteUrl).toContain('/wardrobe-share/invite/');

  await bobPage.goto(inviteUrl);
  await expect(bobPage.getByText('My Wardrobe')).toBeVisible();
  await bobPage.locator('form[action$="/accept"] [type=submit]').click();
  await expect(bobPage).toHaveURL(/\/wardrobe-share\/manage/);

  await bobPage.goto('/wardrobe');
  await switchWardrobe(bobPage, alice);
  await expect(bobPage.getByText(JACKET)).toBeVisible();
  await expect(bobPage.getByText(DIARY)).toHaveCount(0);
  await expect(bobPage.getByRole('link', { name: /New Garment/ })).toHaveCount(
    0,
  );

  const switcherText = await bobPage.locator('#wardrobe-switcher').innerText();
  expect(switcherText).not.toContain(PRIVATE_NAME);

  const privateList = await bobPage.goto(
    `/wardrobe?wardrobeId=${privateWardrobeId}`,
  );
  expect(privateList?.status()).toBe(403);
  const privateItem = await bobPage.goto(`/wardrobe/${diaryId}`);
  expect(privateItem?.status()).toBe(403);
});

test('moving a garment into the shared wardrobe shares it', async () => {
  await alicePage.goto(`/wardrobe/${diaryId}/edit`);
  await alicePage
    .locator('select[name=wardrobeId]')
    .selectOption({ label: 'My Wardrobe' });
  await alicePage.locator('form[action^="/wardrobe"] [type=submit]').click();
  await expect(alicePage).toHaveURL(new RegExp(`/wardrobe/${diaryId}$`));

  const item = await bobPage.goto(`/wardrobe/${diaryId}`);
  expect(item?.status()).toBe(200);
  await expect(bobPage.getByText(DIARY).first()).toBeVisible();
});

test('the default wardrobe can be changed, and empty wardrobes deleted', async () => {
  await alicePage.goto('/wardrobes');
  const row = () => alicePage.locator('li', { hasText: PRIVATE_NAME });
  await row().getByRole('button', { name: 'Open by default' }).click();
  await expect(row().getByText('Opens first')).toBeVisible();

  await alicePage.goto('/wardrobe');
  await expect(alicePage.locator('h1')).toHaveText(PRIVATE_NAME);

  // The default wardrobe cannot be deleted
  await alicePage.goto('/wardrobes');
  await expect(row().getByRole('button', { name: 'Delete' })).toHaveCount(0);

  const myRow = alicePage.locator('li', { hasText: 'My Wardrobe' });
  await myRow.getByRole('button', { name: 'Open by default' }).click();
  await expect(myRow.getByText('Opens first')).toBeVisible();
  await row().getByRole('button', { name: 'Delete' }).click();
  await expect(row()).toHaveCount(0);

  await alicePage.goto('/wardrobe');
  await expect(alicePage.locator('h1')).toHaveText('My Wardrobe');
});
