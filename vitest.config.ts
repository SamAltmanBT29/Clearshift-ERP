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
        'apps/erp/modules/erp-5/src/**',
        'apps/erp/modules/erp-5/web/src/**',
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
    // The array form is required: Vite matches a string alias by prefix, so
    // the deep workspace path must be matched **before** the package root or
    // the root alias swallows the sub-path. The root `tsconfig.json` already
    // declares the same `@cs/<pkg>/*` convention.
    alias: [
      {
        find: /^@cs\/core\/(.*)\.js$/,
        replacement: resolve(__dirname, './packages/core/src/$1.ts'),
      },
      {
        find: '@clearshift/database',
        replacement: resolve(__dirname, './packages/database/src/index.ts'),
      },
      {
        find: '@cs/db',
        replacement: resolve(__dirname, './packages/database/src/index.ts'),
      },
      {
        find: '@clearshift/contracts',
        replacement: resolve(__dirname, './packages/contracts/src/index.ts'),
      },
      {
        find: '@cs/kernel',
        replacement: resolve(__dirname, './packages/kernel/src/index.ts'),
      },
      {
        find: '@cs/core',
        replacement: resolve(__dirname, './packages/core/src/index.ts'),
      },
      {
        find: '@cs/kit',
        replacement: resolve(__dirname, './packages/kit/src/index.ts'),
      },
      {
        find: '@cs/identity',
        replacement: resolve(__dirname, './packages/identity/src/index.ts'),
      },
      {
        find: '@cs/rbac',
        replacement: resolve(__dirname, './packages/rbac/src/index.ts'),
      },
      {
        find: '@cs/ui',
        replacement: resolve(__dirname, './packages/ui/src/index.ts'),
      },
      {
        find: '@cs/mod-erp2',
        replacement: resolve(__dirname, './apps/erp/modules/erp-2/src/index.ts'),
      },
    ],
  },
});
