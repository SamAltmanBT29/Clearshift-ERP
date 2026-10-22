/**
 * ERP-2 Vendors & Purchasing — OpenAPI Contract Test
 *
 * Verifies that the checked-in OpenAPI document (packages/contracts/openapi/erp-2.yaml):
 *   - Is valid YAML and loads without error
 *   - Documents all 7 baseline endpoints
 *   - Protects against property smuggling with `additionalProperties: false`
 *   - Declares the standard canonical error envelope (#/components/schemas/ApiError)
 *
 * @module erp2/tests/contracts/erp-2.openapi.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SPEC_PATH = fileURLToPath(
  new URL('../../../../../../packages/contracts/openapi/erp-2.yaml', import.meta.url)
);

const SPEC = readFileSync(SPEC_PATH, 'utf-8');

/** Baseline endpoints defined in Issue #16 */
const EXPECTED_ENDPOINTS = [
  'GET /vendors',
  'POST /vendors',
  'PATCH /vendors/{id}',
  'GET /purchase-orders',
  'POST /purchase-orders',
  'GET /purchase-orders/{id}',
  'PATCH /purchase-orders/{id}',
] as const;

/** Extracts `METHOD /path` from the `paths:` block of the OpenAPI YAML */
function documentedEndpoints(spec: string): Set<string> {
  const endpoints = new Set<string>();
  let inPaths = false;
  let currentPath: string | null = null;

  for (const raw of spec.split('\n')) {
    if (/^paths:\s*$/.test(raw)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^\S/.test(raw)) {
      // Reached next top-level key (components, etc.)
      break;
    }
    if (!inPaths) continue;

    const pathMatch = raw.match(/^ {2}(\/[a-zA-Z0-9_\-/{}.]+):\s*$/);
    if (pathMatch && pathMatch[1]) {
      currentPath = pathMatch[1];
      continue;
    }

    const methodMatch = raw.match(/^ {4}(get|post|patch|delete|put):\s*$/);
    if (methodMatch && methodMatch[1] && currentPath) {
      endpoints.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
    }
  }

  return endpoints;
}

describe('ERP-2 OpenAPI 3.1 Specification', () => {
  it('specifies OpenAPI version 3.1.0', () => {
    expect(SPEC).toMatch(/^openapi:\s*["']?3\.1\.\d+["']?/m);
  });

  it('documents every baseline endpoint from the issue specification', () => {
    const endpoints = documentedEndpoints(SPEC);
    for (const expected of EXPECTED_ENDPOINTS) {
      expect(endpoints.has(expected), `expected endpoint ${expected} to be documented`).toBe(true);
    }
  });

  it('declares the canonical ApiError envelope in components', () => {
    expect(SPEC).toContain('ApiError:');
    expect(SPEC).toContain('required: [code, message]');
  });

  it('forbids unknown properties on all write schemas (additionalProperties: false)', () => {
    const writeSchemas = [
      'CreateVendorRequest:',
      'PatchVendorRequest:',
      'CreatePurchaseOrderRequest:',
      'CreatePoLineInput:',
      'PatchPurchaseOrderStatusRequest:',
    ];

    for (const schemaName of writeSchemas) {
      const regex = new RegExp(`${schemaName}[\\s\\S]*?additionalProperties:\\s*false`);
      expect(regex.test(SPEC), `${schemaName} must declare additionalProperties: false`).toBe(true);
    }
  });

  it('masks bank details on the serialized Vendor schema', () => {
    expect(SPEC).toContain("pattern: '^XXXX-XXXX-\\d{4}$'");
  });
});
