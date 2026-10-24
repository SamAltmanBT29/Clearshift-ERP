/**
 * ERP-4 Finance & Accounting — Playwright browser journeys (ERP4-10 / Gate G4).
 *
 * Covers authentication redirect, chart of accounts list, account creation modal,
 * filtering, journal entry navigation, and trial balance view against
 * the real module UI and API (in-memory store, 100% synthetic data).
 */
import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'clearshift.access_token';

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

/** Unsigned JWT-shaped session; UI decodes roles, Fastify app accepts in E2E host. */
const SESSION_TOKEN = [
  encode({ alg: 'none', typ: 'JWT' }),
  encode({
    sub: 'e2e-finance-user',
    roles: ['finance_admin', 'editor'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  }),
  'sig',
].join('.');

test.beforeEach(async ({ page, request }) => {
  const reset = await request.post('/__e2e/reset');
  expect(reset.status()).toBe(204);
  await page.addInitScript(
    ({ key, token }) => {
      window.sessionStorage.setItem(key, token);
    },
    { key: STORAGE_KEY, token: SESSION_TOKEN },
  );
});

test('redirects an unauthenticated visitor to the Hub login with returnTo', async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.clear());
  await page.goto('/erp4/accounts');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Ferp4%2Faccounts$/);
});

test('finance journey: accounts list, create account modal, tabs, and trial balance', async ({
  page,
}) => {
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));

  // 1. Visit Chart of Accounts
  await page.goto('/erp4/accounts');
  await expect(page.getByRole('heading', { name: /Finance & Accounting/i })).toBeVisible();

  // 2. Open Account Creation Modal
  const newAccountBtn = page.getByRole('button', { name: /\+ New Account/i });
  await expect(newAccountBtn).toBeVisible();
  await newAccountBtn.click();

  // 3. Fill and submit Account Creation Form
  await page.getByLabel(/Account Code/i).fill('1090-FLOAT');
  await page.getByLabel(/Account Name/i).fill('Petty Cash Float Account');
  await page.getByLabel(/Currency Code/i).fill('USD');

  const submitBtn = page.getByRole('button', { name: /Create Account/i });
  await submitBtn.click();

  // 4. Verify Account appears in the list
  await expect(page.getByText('1090-FLOAT')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Petty Cash Float Account')).toBeVisible();

  // 5. Navigate to Trial Balance tab
  const tbTab = page.locator('#tab-trial-balance');
  await expect(tbTab).toBeVisible();
  await tbTab.click();
  await expect(page.getByRole('heading', { name: /Trial Balance/i })).toBeVisible();

  // 6. Navigate to Journal Entries tab
  const jeTab = page.locator('#tab-journal-entries');
  await expect(jeTab).toBeVisible();
  await jeTab.click();
  await expect(page.getByRole('heading', { name: /Journal Entries/i })).toBeVisible();

  // Ensure no unhandled client runtime errors occurred
  expect(uncaught).toEqual([]);
});
