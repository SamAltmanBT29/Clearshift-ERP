import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'apps/**/*.test.{ts,tsx}',
      'packages/**/*.test.{ts,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'apps/erp/modules/erp-4/domain/**',
        'apps/erp/modules/erp-4/src/**',
        'apps/erp/modules/erp-5/db/**',
        'packages/contracts/src/**',
        'packages/database/src/**',
      ],
      exclude: ['**/node_modules/**', '**/dist/**', '**/server.ts'],
      thresholds: {
        // Acceptance criterion: ≥ 80% coverage
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@clearshift/database': resolve(__dirname, './packages/database/src/index.ts'),
      '@clearshift/contracts': resolve(__dirname, './packages/contracts/src/index.ts'),
    },
  },
});
