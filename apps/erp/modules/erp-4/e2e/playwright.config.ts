import { defineConfig, devices } from '@playwright/test';

const PORT = 5177;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const IN_CI = Boolean(process.env['CI']);

/**
 * ERP-4 browser journeys (ERP4-10 / Gate G4). Run from the repository root:
 *   npm run erp4:e2e
 * Zero retries on purpose: a test that needs a retry is a flaky test.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: IN_CI,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  outputDir: './.artifacts/test-results',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: './.artifacts/report' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: `npx vite --config apps/erp/modules/erp-4/e2e/vite.e2e.config.ts --port ${PORT} --strictPort --host 127.0.0.1`,
    cwd: process.cwd(),
    url: BASE_URL,
    reuseExistingServer: !IN_CI,
    timeout: 120_000,
  },
});
