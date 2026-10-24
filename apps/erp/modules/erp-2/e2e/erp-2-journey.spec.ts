/**
 * ERP-2 Vendors & Purchasing — Playwright browser journeys (ERP2-29).
 *
 * Covers create, list, filter and detail view in Chromium and Firefox against
 * the real module UI and API (in-memory store, 100% synthetic data).
 */
import { expect, test, type Page } from '@playwright/test';

const API = '/api/v1/erp-vendors';
const STORAGE_KEY = 'clearshift.access_token';
const PRODUCT_A = '5eed0000-0000-4000-8000-0000000000a1';
const PRODUCT_B = '5eed0000-0000-4000-8000-0000000000a2';

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

/** Unsigned JWT-shaped session; the UI only decodes claims, the API is open in the host. */
const SESSION_TOKEN = [
  encode({ alg: 'none', typ: 'JWT' }),
  encode({
    sub: 'e2e-user',
    roles: ['purchasing_admin'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  }),
  'sig',
].join('.');

const ACME = {
  name: 'Acme E2E Supplies',
  tax: 'TX-E2E-0001',
  email: 'procurement@example.com',
  bank: '1234567890',
};
const GLOBEX = {
  name: 'Globex E2E Trading',
  tax: 'TX-E2E-0002',
  email: 'orders@example.org',
  bank: '9876543210',
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

async function createVendorThroughForm(page: Page, vendor: typeof ACME): Promise<void> {
  await page.goto('/erp2/vendors/new');
  await page.getByLabel('Legal Name').fill(vendor.name);
  await page.getByLabel('Tax Number / EIN').fill(vendor.tax);
  await page.getByLabel('Procurement Email').fill(vendor.email);
  await page.getByLabel('Bank Account Details').fill(vendor.bank);
  await page.getByRole('button', { name: 'Create Vendor' }).click();
  await expect(page).toHaveURL(/\/erp2\/vendors\/[0-9a-f-]{36}$/);
}

function detailValue(page: Page, label: string) {
  return page.locator('.cs-detail-item', { hasText: label }).locator('.cs-detail-value');
}

test('redirects an unauthenticated visitor to the Hub login with returnTo', async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.clear());
  await page.goto('/erp2/vendors');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Ferp2%2Fvendors$/);
});

test('vendor journey: empty list, create, detail with masked bank, list and search filter', async ({
  page,
}) => {
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));

  // Empty state
  await page.goto('/erp2/vendors');
  await expect(
    page.getByRole('heading', { name: 'Vendors & Purchasing', level: 1 }),
  ).toBeVisible();
  await expect(page.getByText('No vendors found')).toBeVisible();

  // Create + detail view
  await createVendorThroughForm(page, ACME);
  await expect(detailValue(page, 'Tax Number')).toHaveText(ACME.tax);
  await expect(detailValue(page, 'Procurement Email')).toHaveText(ACME.email);
  await expect(detailValue(page, 'Banking Account')).toContainText('XXXX-XXXX-7890');
  await expect(page.locator('body')).not.toContainText(ACME.bank);

  await createVendorThroughForm(page, GLOBEX);

  // List shows both, bank stays masked
  await page.goto('/erp2/vendors');
  const table = page.getByRole('region', { name: 'Vendors table' });
  await expect(table.getByText(ACME.name)).toBeVisible();
  await expect(table.getByText(GLOBEX.name)).toBeVisible();
  await expect(page.getByLabel('Vendor list pagination')).toContainText(/of 2 vendors/);
  await expect(table.getByText('XXXX-XXXX-3210')).toBeVisible();
  await expect(table).not.toContainText(GLOBEX.bank);

  // Search filter
  const searchInput = page.locator('#erp2-vendor-search-input');
  const filtered = page.waitForResponse(
    (response) => response.url().includes(`${API}/vendors?`) && response.url().includes('search=Globex'),
  );
  await searchInput.fill('Globex');
  expect((await filtered).status()).toBe(200);
  await expect(table.getByText(GLOBEX.name)).toBeVisible();
  await expect(table.getByText(ACME.name)).toHaveCount(0);

  // Clearing the search restores the full list
  await page.getByRole('button', { name: 'Clear search input' }).click();
  await expect(table.getByText(ACME.name)).toBeVisible();
  await expect(table.getByText(GLOBEX.name)).toBeVisible();

  expect(uncaught).toEqual([]);
});

test('purchase order journey: status filter narrows the list to the transitioned order', async ({
  page,
  request,
}) => {
  const vendorResponse = await request.post(`${API}/vendors`, {
    data: {
      name: ACME.name,
      tax_number: ACME.tax,
      email: ACME.email,
      currency: 'USD',
      bank_details: ACME.bank,
    },
  });
  expect(vendorResponse.status()).toBe(201);
  const vendor = (await vendorResponse.json()) as { id: string };

  const poIds: string[] = [];
  for (const productId of [PRODUCT_A, PRODUCT_B]) {
    const created = await request.post(`${API}/purchase-orders`, {
      data: {
        vendor_id: vendor.id,
        order_date: '2026-10-23',
        currency: 'USD',
        lines: [{ product_id: productId, quantity: '2.00', price: '10.00' }],
      },
    });
    expect(created.status()).toBe(201);
    poIds.push(((await created.json()) as { id: string }).id);
  }
  const sent = await request.patch(`${API}/purchase-orders/${poIds[0]}`, {
    data: { status: 'Sent' },
  });
  expect(sent.status()).toBe(200);

  await page.goto('/erp2/vendors');
  await page.getByRole('tab', { name: /Purchase Orders/ }).click();

  const filtered = page.waitForResponse(
    (response) =>
      response.url().includes(`${API}/purchase-orders?`) && response.url().includes('status=Sent'),
  );
  await page.locator('#po-status-select').selectOption('Sent');
  const response = await filtered;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { total: number; items: { status: string }[] };
  expect(body.total).toBe(1);
  expect(body.items.map((item) => item.status)).toEqual(['Sent']);
  await expect(page.locator('#po-status-select')).toHaveValue('Sent');
});
