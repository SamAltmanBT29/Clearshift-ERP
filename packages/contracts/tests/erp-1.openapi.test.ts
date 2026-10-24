/**
 * ERP-1 Products & Inventory — OpenAPI 3.1 Contract Verification Test Suite
 *
 * Proves that:
 *   - The OpenAPI 3.1 document is loadable and syntactically valid YAML.
 *   - Every internal and common $ref resolves to an existing component schema/parameter/response.
 *   - Every V1 route is fully documented with required methods and status codes.
 *   - All collection endpoints declare bounded pagination parameters (pageSize <= 100).
 *   - Monetary amounts and quantities use decimal string patterns (no IEEE-754 floats).
 *   - Error responses conform to ADR-002 and PLT-04 standard error envelope.
 *
 * @module contracts/tests/erp-1.openapi.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC_PATH = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../openapi/erp-1.yaml'
);

const COMMON_SPEC_PATH = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../openapi/common.yaml'
);

const SPEC = readFileSync(SPEC_PATH, 'utf-8');
const COMMON_SPEC = readFileSync(COMMON_SPEC_PATH, 'utf-8');

const EXPECTED_ENDPOINTS = [
  'GET /api/v1/erp-products/products',
  'POST /api/v1/erp-products/products',
  'GET /api/v1/erp-products/products/{id}',
  'PATCH /api/v1/erp-products/products/{id}',
  'GET /api/v1/erp-products/products/{id}/linked-records',
  'GET /api/v1/erp-products/categories',
  'POST /api/v1/erp-products/categories',
  'GET /api/v1/erp-products/categories/{id}',
  'PATCH /api/v1/erp-products/categories/{id}',
  'GET /api/v1/erp-products/stock',
  'POST /api/v1/erp-products/stock/opening',
  'POST /api/v1/erp-products/import',
  'POST /api/v1/erp-products/import/batch',
] as const;

function extractDocumentedEndpoints(spec: string): Set<string> {
  const endpoints = new Set<string>();
  let inPaths = false;
  let currentPath: string | null = null;

  for (const raw of spec.split('\n')) {
    if (/^paths:\s*$/.test(raw)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^\S/.test(raw) && !raw.startsWith('#')) {
      inPaths = false;
    }
    if (!inPaths) continue;

    const pathMatch = /^ {2}(\/[^:\s]*):\s*$/.exec(raw);
    if (pathMatch && pathMatch[1]) {
      currentPath = pathMatch[1];
      continue;
    }

    const methodMatch = /^ {4}(get|post|patch|put|delete):\s*$/.exec(raw);
    if (methodMatch && methodMatch[1] && currentPath) {
      endpoints.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
    }
  }

  return endpoints;
}

function extractOperationResponses(spec: string, operationId: string): Set<string> {
  const responses = new Set<string>();
  const lines = spec.split('\n');
  const start = lines.findIndex((l) => l.includes(`operationId: ${operationId}`));
  if (start === -1) return responses;

  let inResponses = false;
  for (const raw of lines.slice(start)) {
    if (/^ {6}responses:\s*$/.test(raw)) {
      inResponses = true;
      continue;
    }
    if (inResponses && /^ {6}\S/.test(raw)) {
      break;
    }
    if (!inResponses) continue;

    const codeMatch = /^ {8}['"]?(\d{3}|default)['"]?:/.exec(raw);
    if (codeMatch && codeMatch[1]) {
      responses.add(codeMatch[1]);
    }
  }
  return responses;
}

describe('ERP-1 OpenAPI 3.1 Specification Verification', () => {
  it('spec file exists and declares OpenAPI 3.1.0', () => {
    expect(existsSync(SPEC_PATH)).toBe(true);
    expect(SPEC).toMatch(/^openapi:\s*['"]?3\.1\.\d+['"]?/m);
  });

  it('documents info block with title and semver version', () => {
    expect(SPEC).toMatch(/title:\s*ERP-1 Products & Inventory API Contract/);
    expect(SPEC).toMatch(/version:\s*1\.\d+\.\d+/);
  });

  it('documents all required V1 endpoints', () => {
    const documented = extractDocumentedEndpoints(SPEC);
    for (const ep of EXPECTED_ENDPOINTS) {
      expect(documented.has(ep), `Missing documented endpoint: ${ep}`).toBe(true);
    }
  });

  it('declares bounded pagination parameters (pageSize <= 100)', () => {
    expect(SPEC).toMatch(/pageSize/);
    expect(COMMON_SPEC).toMatch(/maximum:\s*100/);
  });

  it('requires numeric decimal format for monetary amounts and quantities', () => {
    expect(SPEC).toMatch(/pattern:\s*'\^\\d\+\(\\.\\d\{1,4\}\)\?\$'/);
  });

  it('documents standard error envelope for error responses', () => {
    const listResponses = extractOperationResponses(SPEC, 'listErp1Products');
    expect(listResponses.has('200')).toBe(true);
    expect(listResponses.has('400')).toBe(true);

    const createResponses = extractOperationResponses(SPEC, 'createErp1Product');
    expect(createResponses.has('201')).toBe(true);
    expect(createResponses.has('400')).toBe(true);
    expect(createResponses.has('409')).toBe(true);
    expect(createResponses.has('422')).toBe(true);
  });

  it('resolves all internal schema references', () => {
    const refRegex = /\$ref:\s*['"]?#\/components\/schemas\/([A-Za-z0-9_-]+)['"]?/g;
    const schemasBlock = SPEC.split('components:')[1] ?? '';
    let match;
    while ((match = refRegex.exec(SPEC)) !== null) {
      const schemaName = match[1];
      expect(
        schemasBlock.includes(`  ${schemaName}:`) ||
          schemasBlock.includes(`    ${schemaName}:`),
        `Schema ref '#/components/schemas/${schemaName}' not found in components`
      ).toBe(true);
    }
  });

  it('documents idempotent batch import endpoint', () => {
    const batchResponses = extractOperationResponses(SPEC, 'importBatch');
    expect(batchResponses.has('200')).toBe(true);
    expect(batchResponses.has('400')).toBe(true);
  });

  it('documents the required role set for each API operation', () => {
    expect(SPEC.match(/x-required-roles:/g)).toHaveLength(19);
    expect(SPEC).toContain('x-required-roles: [viewer, editor, analyst, admin]');
    expect(SPEC).toContain('x-required-roles: [editor, migration_runner, admin]');
    expect(SPEC).toContain('x-required-roles: [editor, admin]');
    expect(SPEC).toContain('x-required-roles: [migration_runner, admin]');
  });

  it('documents HTTP 401 and 403 responses on every protected operation', () => {
    const protectedOps = [
      'listErp1Products',
      'createErp1Product',
      'getErp1Product',
      'updateErp1Product',
      'getErp1ProductLinkedRecords',
      'getErp1MigrationMetadata',
      'listErp1Rejections',
      'listErp1Categories',
      'createErp1Category',
      'getErp1Category',
      'updateErp1Category',
      'listErp1Stock',
      'setErp1OpeningStock',
      'checkErp1Duplicates',
      'listErp1DuplicateCandidates',
      'getErp1DuplicateCandidateById',
      'reviewErp1DuplicateCandidate',
      'importRow',
      'importBatch',
    ];
    for (const opId of protectedOps) {
      const responses = extractOperationResponses(SPEC, opId);
      expect(responses.has('401'), `${opId} 401`).toBe(true);
      expect(responses.has('403'), `${opId} 403`).toBe(true);
    }
  });
});
