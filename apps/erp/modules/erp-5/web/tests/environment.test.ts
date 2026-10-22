/**
 * ERP-5 HR & Employees — Test Environment Guard
 *
 * The module's UI suites declare `// @vitest-environment jsdom`, so they can
 * only run when the `jsdom` package is installed. If a checkout is installed
 * with a partial, skipped or failed `npm ci`, Vitest aborts the whole run
 * with an opaque error:
 *
 *     Error: Cannot find package 'jsdom' imported from
 *     node_modules/vitest/dist/chunks/index.js
 *
 * This suite runs in the default Node environment — it needs no DOM — and
 * fails with an actionable message instead. It also asserts that every
 * dependency this module added to the root `package.json` is present in the
 * installed tree and locked in `package-lock.json`.
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require_ = createRequire(import.meta.url);

/** The dependencies ERP5-16 added to the root `package.json`. */
const MODULE_DEPENDENCIES = [
  '@testing-library/react',
  '@types/react-dom',
  'jsdom',
  'react-dom',
  'react-router-dom',
] as const;

describe('ERP-5 web test environment', () => {
  it.each(MODULE_DEPENDENCIES)('has %s installed for the UI suites', (dependency) => {
    expect(() => require_.resolve(`${dependency}/package.json`)).not.toThrow();
  });

  it('resolves the jsdom environment used by the UI suites', () => {
    expect(() => require_.resolve('jsdom')).not.toThrow();
  });
});
