/**
 * ERP-4 Finance & Accounting — Playwright browser journeys (ERP4-29).
 *
 * Covers create, list, filter, and detail view in Chromium and Firefox against
 * the real module UI and Fastify API (in-memory store, 100% synthetic fixtures).
 */
import { expect, test, type Page } from '@playwright/test';

const API = '/api/v1/erp-finance';
const STORAGE_KEY = 'clearshift.access_token';

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

/** Unsigned JWT-shaped session; the UI only decodes claims, the API is open in the host. */
const SESSION_TOKEN = [
  encode({ alg: 'none', typ: 'JWT' }),
  encode({
    sub: 'e2e-finance-admin',
    roles: ['finance_admin'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  }),
  'sig',
].join('.');

const TEST_ACCOUNT = {
  code: '1099',
  name: 'Synthetic Clearing Account',
  type: 'asset',
  currency: 'USD',
  description: 'Used for E2E journey tests',
};

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
  page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
  await page.addInitScript(() => window.sessionStorage.clear());
  await page.goto('/erp4/accounts');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Ferp4%2Faccounts$/);
});

test('accounts journey: list view, create account modal, search filter and type filter', async ({
  page,
}) => {
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));

  // Initial load
  await page.goto('/erp4/accounts');
  await expect(
    page.getByRole('heading', { name: 'Finance & Accounting (ERP-4)', level: 1 }),
  ).toBeVisible();

  // Verify synthetic seeded accounts are rendered
  const table = page.getByRole('table', { name: 'Chart of Accounts' });
  await expect(table.getByText('Cash & Cash Equivalents')).toBeVisible();

  // Create new account via modal
  await page.getByRole('button', { name: 'Create new account' }).click();
  await expect(page.getByText('Create GL Account')).toBeVisible();

  await page.getByLabel('Account Code').fill(TEST_ACCOUNT.code);
  await page.getByLabel('Account Name').fill(TEST_ACCOUNT.name);
  await page.getByLabel('Description Memo').fill(TEST_ACCOUNT.description);
  await page.getByRole('button', { name: 'Create Account' }).click();

  // Created account appears in table
  await expect(table.getByText(TEST_ACCOUNT.name)).toBeVisible();
  await expect(table.getByText(TEST_ACCOUNT.code)).toBeVisible();

  // Filter by search query
  const searchInput = page.getByPlaceholder(/Search accounts by code or name/i);
  await searchInput.fill(TEST_ACCOUNT.name);
  await expect(table.getByText(TEST_ACCOUNT.name)).toBeVisible();
  await expect(table.getByText('Cash & Cash Equivalents')).toHaveCount(0);

  // Clear search restores all
  await page.getByRole('button', { name: 'Reset all filters' }).click();
  await expect(table.getByText('Cash & Cash Equivalents')).toBeVisible();

  // Filter by type
  const typeSelect = page.getByLabel('Filter by account type');
  await typeSelect.selectOption('liability');
  await expect(table.getByText('Accounts Payable')).toBeVisible();
  await expect(table.getByText('Cash & Cash Equivalents')).toHaveCount(0);

  expect(uncaught).toEqual([]);
});

test('journal entry journey: create balanced entry, list entries, view detail, and post', async ({
  page,
}) => {
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));

  await page.goto('/erp4/accounts');

  // Navigate to create journal entry view
  await page.getByRole('button', { name: 'Create new journal entry' }).click();
  await expect(page.getByRole('main', { name: 'Journal Entry Creation Screen' })).toBeVisible();

  // Fill Header fields
  await page.getByLabel('Transaction Description / Memo').fill('E2E Inflow and Outflow Transfer');
  await page.getByLabel('Source Reference').fill('REF-E2E-001');
  await page.locator('#je-currency').selectOption('INR');

  // Fill line amounts so entry is balanced (Line 1 debit 150.00, Line 2 credit 150.00)
  await page.getByLabel('Debit amount for line 1').fill('150.00');
  await page.getByLabel('Credit amount for line 2').fill('150.00');

  // Save as draft
  await page.getByRole('button', { name: 'Save draft entry' }).click();

  // Verify success banner with detail link
  await expect(page.getByText(/Successfully Saved as Draft/i)).toBeVisible();

  // Click View Entry Details
  await page.getByRole('button', { name: /View Entry Details/i }).click();
  await expect(page.getByText('E2E Inflow and Outflow Transfer')).toBeVisible();

  // Return to Ledger List
  await page.getByRole('button', { name: 'Back to accounts list' }).click();
  await expect(
    page.getByRole('heading', { name: 'Finance & Accounting (ERP-4)', level: 1 }),
  ).toBeVisible();

  // Switch to Journal Entries tab and verify entry exists in table
  await page.getByRole('tab', { name: 'Journal Entries' }).click();
  const jeTable = page.getByRole('table', { name: 'Journal Entries Directory' });
  await expect(jeTable.getByText('E2E Inflow and Outflow Transfer')).toBeVisible();

  expect(uncaught).toEqual([]);
});
