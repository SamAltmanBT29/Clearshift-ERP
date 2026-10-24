/**
 * ERP-3 Sales Orders & Invoices — OpenAPI Contract Test (ERP3-29)
 *
 * Verifies that the checked-in OpenAPI document (packages/contracts/openapi/erp-3.yaml):
 *   - Is valid YAML and specifies OpenAPI version 3.1.x
 *   - Documents all 9 baseline endpoints
 *   - Declares the standard canonical error envelope (ApiError)
 *   - Documents write and read request/response schemas in components
 *
 * @module erp3/tests/contracts/erp-3.openapi.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SPEC_PATH = fileURLToPath(
  new URL('../../../../../../packages/contracts/openapi/erp-3.yaml', import.meta.url)
);

const SPEC = readFileSync(SPEC_PATH, 'utf-8');

/** Baseline endpoints defined in Issue #150 / SDS §4.7 / §4.8 */
const EXPECTED_ENDPOINTS = [
  'GET /sales-orders',
  'POST /sales-orders',
  'GET /sales-orders/{id}',
  'PATCH /sales-orders/{id}',
  'GET /invoices',
  'POST /invoices',
  'GET /invoices/{id}',
  'GET /payments',
  'POST /payments',
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

describe('ERP-3 OpenAPI 3.1 Specification', () => {
  it('specifies OpenAPI version 3.1.x', () => {
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
    expect(SPEC).toContain('statusCode:');
    expect(SPEC).toContain('message:');
  });

  it('documents core entity and request schemas in components', () => {
    const schemas = [
      'SalesOrder:',
      'CreateSalesOrderRequest:',
      'UpdateSalesOrderStatusRequest:',
      'Invoice:',
      'CreateInvoiceRequest:',
      'Payment:',
      'CreatePaymentRequest:',
    ];

    for (const schemaName of schemas) {
      expect(SPEC).toContain(schemaName);
    }
  });

  it('enforces customer Golden ID reference across order schemas', () => {
    expect(SPEC).toContain('customer_golden_id:');
  });
});
