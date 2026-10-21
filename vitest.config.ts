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
      '@cs/kernel': resolve(__dirname, './packages/kernel/src/index.ts'),
      '@cs/core': resolve(__dirname, './packages/core/src/index.ts'),
      '@cs/kit': resolve(__dirname, './packages/kit/src/index.ts'),
      '@cs/db': resolve(__dirname, './packages/database/src/index.ts'),
      '@cs/identity': resolve(__dirname, './packages/identity/src/index.ts'),
      '@cs/rbac': resolve(__dirname, './packages/rbac/src/index.ts'),
      '@cs/mod-erp1': resolve(__dirname, './apps/erp/modules/erp-1/src/index.ts'),
      '@cs/mod-erp2': resolve(__dirname, './apps/erp/modules/erp-2/src/index.ts'),
    },
  },
});
