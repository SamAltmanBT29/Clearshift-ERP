/**
 * ERP-3 Sales Orders & Invoices — Playwright browser journeys (ERP3-29).
 *
 * Covers create, list, filter and detail view in Chromium and Firefox against
 * the real module UI and API (in-memory store, 100% synthetic data).
 */
import { expect, test, type Page } from '@playwright/test';

const API = '/api/v1/erp-orders';
const STORAGE_KEY = 'clearshift.access_token';
const CUSTOMER_A = '55555555-0003-4000-8000-000000000001';
const CUSTOMER_B = '55555555-0003-4000-8000-000000000002';
const PRODUCT_A = '11111111-0001-4000-8000-000000000001';
const PRODUCT_B = '11111111-0001-4000-8000-000000000002';

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

/** Unsigned JWT-shaped session; the UI decodes claims, the API is open in the E2E host. */
const SESSION_TOKEN = [
  encode({ alg: 'none', typ: 'JWT' }),
  encode({
    sub: 'e2e-user',
    roles: ['editor', 'admin'],
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

async function createOrderThroughForm(
  page: Page,
  customerGid: string,
  productId: string,
  qty: string = '2',
  price: string = '50.0000',
  taxRate: string = '10.0000'
): Promise<void> {
  await page.goto('/erp3/sales-orders/new');
  await page.locator('#order-customer-gid').fill(customerGid);
  await page.locator('#order-date').fill('2026-10-24');
  await page.getByLabel('Line 1 Product ID').fill(productId);
  await page.getByLabel('Line 1 Quantity').fill(qty);
  await page.getByLabel('Line 1 Unit Price').fill(price);
  await page.getByLabel('Line 1 Tax Rate').fill(taxRate);
  await page.getByRole('button', { name: 'Create Sales Order' }).click();
  await expect(page).toHaveURL(/\/erp3\/sales-orders\/[0-9a-f-]{36}$/);
}

test('redirects an unauthenticated visitor to the Hub login with returnTo', async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.clear());
  await page.goto('/erp3/sales-orders');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Ferp3%2Fsales-orders$/);
});

test('sales order journey: empty list, create, detail view, list, and search filter', async ({
  page,
}) => {
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));

  // 1. Empty state
  await page.goto('/erp3/sales-orders');
  await expect(
    page.getByRole('heading', { name: 'Sales Orders & Invoices', level: 1 })
  ).toBeVisible();
  await expect(page.getByText('No sales orders found')).toBeVisible();

  // 2. Create first sales order & verify detail view
  await createOrderThroughForm(page, CUSTOMER_A, PRODUCT_A, '2', '50.0000', '10.0000');
  await expect(page.locator('h1.cs-page-title')).toContainText('Sales Order');
  await expect(page.locator('.cs-badge')).toHaveText('Open');
  await expect(page.getByText(CUSTOMER_A)).toBeVisible();
  await expect(page.getByText('$110.00 USD')).toBeVisible();

  // 3. Create second sales order for different customer
  await createOrderThroughForm(page, CUSTOMER_B, PRODUCT_B, '1', '200.0000', '0.0000');
  await expect(page.getByText(CUSTOMER_B)).toBeVisible();
  await expect(page.getByText('$200.00 USD')).toBeVisible();

  // 4. List view shows both orders
  await page.goto('/erp3/sales-orders');
  const table = page.getByRole('region', { name: 'Sales orders table' });
  await expect(table.getByText(CUSTOMER_A)).toBeVisible();
  await expect(table.getByText(CUSTOMER_B)).toBeVisible();
  await expect(page.locator('.cs-pagination-info')).toContainText(/of 2 orders/);

  // 5. Search filter narrows the table to matching customer
  const searchInput = page.locator('#order-search-input');
  const filtered = page.waitForResponse(
    (response) =>
      response.url().includes(`${API}/sales-orders?`) &&
      response.url().includes(`search=${CUSTOMER_A}`)
  );
  await searchInput.fill(CUSTOMER_A);
  expect((await filtered).status()).toBe(200);
  await expect(table.getByText(CUSTOMER_A)).toBeVisible();
  await expect(table.getByText(CUSTOMER_B)).toHaveCount(0);

  // 6. Resetting filters restores the full list
  await page.getByRole('button', { name: 'Reset Filters' }).click();
  await expect(table.getByText(CUSTOMER_A)).toBeVisible();
  await expect(table.getByText(CUSTOMER_B)).toBeVisible();

  expect(uncaught).toEqual([]);
});

test('order status transition and status filter journey', async ({ page, request }) => {
  // Create two orders via API
  const orderA = await request.post(`${API}/sales-orders`, {
    data: {
      customer_golden_id: CUSTOMER_A,
      order_date: '2026-10-24',
      currency: 'USD',
      lines: [
        {
          product_id: PRODUCT_A,
          quantity: '1.0000',
          price: '100.0000',
          tax_rate: '10.0000',
        },
      ],
    },
  });
  expect(orderA.status()).toBe(201);
  const createdA = (await orderA.json()) as { id: string; order_number: string };

  const orderB = await request.post(`${API}/sales-orders`, {
    data: {
      customer_golden_id: CUSTOMER_B,
      order_date: '2026-10-24',
      currency: 'USD',
      lines: [
        {
          product_id: PRODUCT_B,
          quantity: '2.0000',
          price: '50.0000',
          tax_rate: '0.0000',
        },
      ],
    },
  });
  expect(orderB.status()).toBe(201);
  const createdB = (await orderB.json()) as { id: string; order_number: string };

  // Transition Order A: Open -> Invoiced in the UI
  await page.goto(`/erp3/sales-orders/${createdA.id}`);
  await expect(page.locator('.cs-badge')).toHaveText('Open');
  await page.getByRole('button', { name: 'Mark Invoiced' }).click();
  await page.getByRole('button', { name: 'Yes, Update Status' }).click();
  await expect(page.locator('.cs-badge')).toHaveText('Invoiced');

  // Navigate to list and filter by Invoiced status
  await page.goto('/erp3/sales-orders');
  const filtered = page.waitForResponse(
    (response) =>
      response.url().includes(`${API}/sales-orders?`) && response.url().includes('status=Invoiced')
  );
  await page.locator('#order-status-select').selectOption('Invoiced');
  const response = await filtered;
  expect(response.status()).toBe(200);

  const table = page.getByRole('region', { name: 'Sales orders table' });
  await expect(table.getByText(createdA.order_number)).toBeVisible();
  await expect(table.getByText(createdB.order_number)).toHaveCount(0);
});
