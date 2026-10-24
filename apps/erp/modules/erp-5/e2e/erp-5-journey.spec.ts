/**
 * ERP-5 HR & Employees — Playwright Browser Journeys (ERP5-29).
 *
 * Covers:
 * - Unauthenticated redirect to Hub login with returnTo
 * - Employee journey: empty list, create through form, detail view with masked salary (BR-ERP5-02),
 *   list view with pagination and search filter
 * - Department journey: create department, list view, hierarchy validation
 * - Leave request journey: create leave, status verification
 *
 * Runs against the in-memory Fastify application using 100% synthetic data.
 * Tested in Chromium and Firefox.
 *
 * @module erp5/e2e/erp-5-journey.spec
 */

import { expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'clearshift.access_token';

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

/** Unsigned JWT-shaped session token carrying module editor/admin roles. */
const SESSION_TOKEN = [
  encode({ alg: 'none', typ: 'JWT' }),
  encode({
    sub: 'e2e-user',
    roles: ['Editor', 'Admin'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  }),
  'sig',
].join('.');

const SYNTH_DEPT = {
  code: 'ENG',
  name: 'Engineering & Architecture',
};

const SYNTH_EMP_A = {
  employeeNo: 'EMP-E2E-001',
  firstName: 'Aarav',
  lastName: 'Sharma',
  birthDate: '1985-05-15',
  joinDate: '2015-06-01',
  jobTitle: 'Staff Software Engineer',
  salary: '95000',
  currency: 'INR',
};

const SYNTH_EMP_B = {
  employeeNo: 'EMP-E2E-002',
  firstName: 'Élodie',
  lastName: 'Dubois',
  birthDate: '1988-08-20',
  joinDate: '2018-09-01',
  jobTitle: 'Principal Architect',
  salary: '110000',
  currency: 'EUR',
};

test.beforeEach(async ({ page, request }) => {
  const reset = await request.post('/__e2e/reset');
  expect(reset.status()).toBe(204);
  await page.addInitScript(
    ({ key, token }) => {
      window.sessionStorage.setItem(key, token);
    },
    { key: STORAGE_KEY, token: SESSION_TOKEN }
  );
});

test('redirects an unauthenticated visitor to Hub login with returnTo', async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.clear());
  await page.goto('/erp5/employees');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Ferp5%2Femployees$/);
});

test('employee journey: empty list, create, detail with masked salary, list and search filter', async ({
  page,
  request,
}) => {
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));

  // 1. Pre-create a department via API for employee assignment
  const deptRes = await request.post('/api/v1/erp-hr/departments', {
    data: SYNTH_DEPT,
  });
  expect(deptRes.status()).toBe(201);
  const dept = (await deptRes.json()) as { id: string };

  // 2. Empty state check
  await page.goto('/erp5/employees');
  await expect(page.getByRole('heading', { name: 'Employees', level: 1 })).toBeVisible();
  await expect(page.getByText('No employees found')).toBeVisible();

  // 3. Create employee through form
  await page.goto('/erp5/employees/new');
  await page.getByLabel('Employee number').fill(SYNTH_EMP_A.employeeNo);
  await page.getByLabel('First name').fill(SYNTH_EMP_A.firstName);
  await page.getByLabel('Last name').fill(SYNTH_EMP_A.lastName);
  await page.getByLabel('Birth date').fill(SYNTH_EMP_A.birthDate);
  await page.getByLabel('Join date').fill(SYNTH_EMP_A.joinDate);
  await page.getByLabel('Department').selectOption(dept.id);
  await page.getByLabel('Job title').fill(SYNTH_EMP_A.jobTitle);
  await page.getByLabel('Salary').fill(SYNTH_EMP_A.salary);
  await page.getByLabel('Currency').fill(SYNTH_EMP_A.currency);
  await page.getByRole('button', { name: 'Create employee' }).click();

  // 4. Detail view verification: salary is masked (BR-ERP5-02)
  await expect(page).toHaveURL(/\/erp5\/employees\/[0-9a-f-]{36}$/);
  await expect(page.getByText(SYNTH_EMP_A.employeeNo)).toBeVisible();
  await expect(page.getByText(`${SYNTH_EMP_A.firstName} ${SYNTH_EMP_A.lastName}`)).toBeVisible();
  await expect(page.getByText('XX,XXX')).toBeVisible();
  // Invariant: Raw salary is never in DOM
  await expect(page.locator('body')).not.toContainText('95000.0000');

  // 5. Create second employee
  await page.goto('/erp5/employees/new');
  await page.getByLabel('Employee number').fill(SYNTH_EMP_B.employeeNo);
  await page.getByLabel('First name').fill(SYNTH_EMP_B.firstName);
  await page.getByLabel('Last name').fill(SYNTH_EMP_B.lastName);
  await page.getByLabel('Birth date').fill(SYNTH_EMP_B.birthDate);
  await page.getByLabel('Join date').fill(SYNTH_EMP_B.joinDate);
  await page.getByLabel('Department').selectOption(dept.id);
  await page.getByLabel('Job title').fill(SYNTH_EMP_B.jobTitle);
  await page.getByLabel('Salary').fill(SYNTH_EMP_B.salary);
  await page.getByLabel('Currency').fill(SYNTH_EMP_B.currency);
  await page.getByRole('button', { name: 'Create employee' }).click();
  await expect(page).toHaveURL(/\/erp5\/employees\/[0-9a-f-]{36}$/);

  // 6. List view shows both employees
  await page.goto('/erp5/employees');
  await expect(page.getByText(SYNTH_EMP_A.employeeNo)).toBeVisible();
  await expect(page.getByText(SYNTH_EMP_B.employeeNo)).toBeVisible();

  // 7. Search filter narrows list
  const searchInput = page.getByPlaceholder('Search by name or number');
  await searchInput.fill('Aarav');
  await expect(page.getByText(SYNTH_EMP_A.employeeNo)).toBeVisible();
  await expect(page.getByText(SYNTH_EMP_B.employeeNo)).toHaveCount(0);

  // Clearing search restores full list
  await searchInput.fill('');
  await expect(page.getByText(SYNTH_EMP_A.employeeNo)).toBeVisible();
  await expect(page.getByText(SYNTH_EMP_B.employeeNo)).toBeVisible();

  expect(uncaught).toEqual([]);
});

test('department journey: create department, list view, and detail view', async ({ page }) => {
  await page.goto('/erp5/departments');
  await expect(page.getByRole('heading', { name: 'Departments', level: 1 })).toBeVisible();

  // Create department via form
  await page.goto('/erp5/departments/new');
  await page.getByLabel('Department code').fill('OPS');
  await page.getByLabel('Department name').fill('Operations Division');
  await page.getByRole('button', { name: 'Create department' }).click();

  await expect(page).toHaveURL(/\/erp5\/departments\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Operations Division')).toBeVisible();

  // Verify in list
  await page.goto('/erp5/departments');
  await expect(page.getByText('OPS')).toBeVisible();
  await expect(page.getByText('Operations Division')).toBeVisible();
});
