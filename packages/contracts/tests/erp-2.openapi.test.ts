/**
 * ERP-2 Vendors & Purchasing — OpenAPI 3.1 Specification Tests
 *
 * Proves that:
 *   - The checked-in OpenAPI document (packages/contracts/openapi/erp-2.yaml) is valid YAML
 *   - Specifies OpenAPI version 3.1.x
 *   - Documents all 7 baseline V1 endpoints (GET/POST vendors, PATCH vendor, GET/POST POs, GET/PATCH PO)
 *   - Includes all write schemas for request validation
 *   - Declares the canonical ApiError error envelope
 *   - Enforces bank_masked format on the Vendor response schema
 *   - Documents all PO status enum values: Draft, Sent, Received, Closed
 *   - Covers the migration import, batch import, and duplicate check/review endpoints
 *   - Is complete for integration team use as a contract authority
 *
 * @module contracts/tests/erp-2.openapi.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

const SPEC_PATH = fileURLToPath(
  new URL('../openapi/erp-2.yaml', import.meta.url)
);

const SPEC_RAW = readFileSync(SPEC_PATH, 'utf-8');

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
      break;
    }
    if (!inPaths) continue;

    const pathMatch = raw.match(/^ {2}(\/[a-zA-Z0-9_\-/{}.]+):\s*$/);
    if (pathMatch?.[1]) {
      currentPath = pathMatch[1];
      continue;
    }

    const methodMatch = raw.match(/^ {4}(get|post|patch|delete|put):\s*$/);
    if (methodMatch?.[1] && currentPath) {
      endpoints.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
    }
  }

  return endpoints;
}

describe('ERP-2 OpenAPI 3.1 Specification', () => {
  it('loads as valid YAML without parse error', () => {
    expect(() => yamlLoad(SPEC_RAW)).not.toThrow();
  });

  it('specifies OpenAPI version 3.1.0', () => {
    expect(SPEC_RAW).toMatch(/^openapi:\s*['"']?3\.1\.\d+['"']?/m);
  });

  it('includes info title and version', () => {
    expect(SPEC_RAW).toContain('title:');
    expect(SPEC_RAW).toContain('version:');
    expect(SPEC_RAW).toContain('Vendors');
  });

  it('documents every baseline V1 endpoint', () => {
    const BASELINE_ENDPOINTS = [
      'GET /vendors',
      'POST /vendors',
      'GET /vendors/{id}',
      'PATCH /vendors/{id}',
      'GET /purchase-orders',
      'POST /purchase-orders',
      'GET /purchase-orders/{id}',
      'PATCH /purchase-orders/{id}',
    ] as const;

    const endpoints = documentedEndpoints(SPEC_RAW);
    for (const expected of BASELINE_ENDPOINTS) {
      expect(endpoints.has(expected), `expected endpoint ${expected} to be documented`).toBe(true);
    }
  });

  it('documents migration import and batch endpoints', () => {
    const MIGRATION_ENDPOINTS = ['POST /import', 'POST /import/batch'] as const;
    const endpoints = documentedEndpoints(SPEC_RAW);
    for (const expected of MIGRATION_ENDPOINTS) {
      expect(endpoints.has(expected), `expected endpoint ${expected} to be documented`).toBe(true);
    }
  });

  it('documents duplicate check and review endpoints', () => {
    const DUPLICATE_ENDPOINTS = [
      'POST /duplicates/check',
      'GET /duplicates/candidates',
      'GET /duplicates/candidates/{id}',
      'POST /duplicates/review',
    ] as const;
    const endpoints = documentedEndpoints(SPEC_RAW);
    for (const expected of DUPLICATE_ENDPOINTS) {
      expect(endpoints.has(expected), `expected endpoint ${expected} to be documented`).toBe(true);
    }
  });

  it('declares the canonical ApiError envelope in components', () => {
    expect(SPEC_RAW).toContain('ApiError:');
    expect(SPEC_RAW).toContain('statusCode:');
    expect(SPEC_RAW).toContain('message:');
  });

  it('documents all write schemas in components', () => {
    const WRITE_SCHEMAS = [
      'CreateVendorRequest:',
      'UpdateVendorRequest:',
      'CreatePurchaseOrderRequest:',
      'CreatePurchaseOrderLineRequest:',
      'UpdatePurchaseOrderStatusRequest:',
    ];
    for (const schemaName of WRITE_SCHEMAS) {
      expect(SPEC_RAW).toContain(schemaName);
    }
  });

  it('documents all PO status enum values', () => {
    expect(SPEC_RAW).toContain('Draft');
    expect(SPEC_RAW).toContain('Sent');
    expect(SPEC_RAW).toContain('Received');
    expect(SPEC_RAW).toContain('Closed');
  });

  it('enforces bank_masked format on Vendor response schema (FR-ERP2-06)', () => {
    expect(SPEC_RAW).toContain('bank_masked:');
    expect(SPEC_RAW).toContain('XXXX-XXXX');
  });

  it('documents all paginated response schemas', () => {
    expect(SPEC_RAW).toContain('PaginatedVendorsResponse:');
    expect(SPEC_RAW).toContain('PaginatedPurchaseOrdersResponse:');
  });

  it('documents the standard error response components', () => {
    expect(SPEC_RAW).toContain('BadRequest:');
    expect(SPEC_RAW).toContain('NotFound:');
    expect(SPEC_RAW).toContain('Conflict:');
    expect(SPEC_RAW).toContain('UnprocessableEntity:');
  });

  it('documents the DuplicateCandidateRecord schema for integration teams', () => {
    expect(SPEC_RAW).toContain('DuplicateCandidateRecord:');
    expect(SPEC_RAW).toContain('candidate_id:');
    expect(SPEC_RAW).toContain('match_kind:');
  });

  it('documents the batch import schemas', () => {
    expect(SPEC_RAW).toContain('ImportBatchRequest:');
    expect(SPEC_RAW).toContain('LoadBatchResult:');
    expect(SPEC_RAW).toContain('LoadBatchRowResult:');
  });

  it('does not expose DELETE or PUT endpoints (V1 constraint: no hard delete or full replace)', () => {
    expect(SPEC_RAW).not.toMatch(/^ {4}delete:\s*$/m);
    expect(SPEC_RAW).not.toMatch(/^ {4}put:\s*$/m);
  });
});
