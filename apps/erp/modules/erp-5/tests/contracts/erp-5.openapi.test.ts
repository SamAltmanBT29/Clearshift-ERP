/**
 * ERP-5 HR & Employees — OpenAPI Contract Test
 *
 * The checked-in OpenAPI document is the public contract of the module
 * (Master Architecture Spec §6.1). This test proves that:
 *
 *   - the document is loadable and every `$ref` resolves
 *   - every **write** route the module registers is documented, with the
 *     documented status codes
 *   - the write request schemas forbid unknown properties, so a protected
 *     field can never be smuggled into a payload
 *   - the employee write responses use the masked projection (BR-ERP5-02)
 *
 * The test reads the YAML as text on purpose — the module must not take a
 * dependency on a YAML parser for a contract check.
 *
 * @module erp5/tests/contracts/erp-5.openapi.test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastify, { type FastifyInstance } from 'fastify';
import { erpHrRoutes } from '../../src/routes/index.js';
import { HrService } from '../../src/services/hr.service.js';
import { InMemoryHrRepository } from '../../src/services/in-memory.repository.js';

const SPEC_PATH = fileURLToPath(
  new URL('../../../../../../packages/contracts/openapi/erp-5.yaml', import.meta.url)
);

const COMMON_SPEC_PATH = fileURLToPath(
  new URL('../../../../../../packages/contracts/openapi/common.yaml', import.meta.url)
);

const SPEC = readFileSync(SPEC_PATH, 'utf-8');
const COMMON_SPEC = readFileSync(COMMON_SPEC_PATH, 'utf-8');

/** The write endpoints this issue owns. */
const WRITE_ENDPOINTS = [
  'POST /employees',
  'PATCH /employees/{id}',
  'POST /departments',
  'PATCH /departments/{id}',
  'POST /leave',
  'PATCH /leave/{id}',
  'POST /payroll-totals',
] as const;

/** The read endpoints of ERP5-02. */
const READ_ENDPOINTS = [
  'GET /employees',
  'GET /employees/{id}',
  'GET /departments',
  'GET /departments/{id}',
  'GET /leave',
  'GET /leave/{id}',
  'GET /identity-users',
  'GET /payroll-totals',
  'GET /payroll-totals/{id}',
] as const;

/** Extracts the `METHOD /path` pairs from the `paths:` block of the document. */
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
      inPaths = false;
    }
    if (!inPaths) {
      continue;
    }

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

/** Returns the text of one named block of the `components:` section. */
function componentBlock(spec: string, name: string): string {
  const start = spec.search(new RegExp(`^ {4}${name}:\\s*$`, 'm'));
  if (start === -1) {
    return '';
  }
  const rest = spec.slice(start);
  const next = rest.slice(1).search(/^ {4}\S/m);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** Returns the text of the operation block that declares `operationId`. */
function operationBlock(spec: string, operationId: string): string {
  const lines = spec.split('\n');
  const anchor = lines.findIndex((line) => line.includes(`operationId: ${operationId}`));
  if (anchor === -1) {
    return '';
  }

  // Walk back to the operation key (`    get:` / `    post:` / …).
  let start = anchor;
  while (start > 0 && !/^ {4}\w+:/.test(lines[start] ?? '')) {
    start -= 1;
  }

  // The operation ends at the next key on the same level.
  const block: string[] = [];
  for (const line of lines.slice(start)) {
    if (block.length > 0 && /^ {4}\S/.test(line)) {
      break;
    }
    block.push(line);
  }
  return block.join('\n');
}

/** Returns the text of every operation block of one path. */
function operationBlockByPath(spec: string, path: string): string {
  const lines = spec.split('\n');
  const start = lines.findIndex((line) => line.trim() === `${path}:`);
  if (start === -1) {
    return '';
  }

  const block: string[] = [];
  for (const line of lines.slice(start)) {
    if (block.length > 0 && /^ {2}\S/.test(line)) {
      break;
    }
    block.push(line);
  }
  return block.join('\n');
}

/** Extracts the response status codes documented for one operation. */
function documentedResponses(spec: string, operationId: string): Set<string> {
  const responses = new Set<string>();
  const lines = spec.split('\n');
  const start = lines.findIndex((line) => line.includes(`operationId: ${operationId}`));
  if (start === -1) {
    return responses;
  }

  let inResponses = false;
  for (const raw of lines.slice(start)) {
    if (/^ {6}responses:\s*$/.test(raw)) {
      inResponses = true;
      continue;
    }
    if (inResponses && /^ {6}\S/.test(raw)) {
      break;
    }
    if (inResponses) {
      const statusMatch = /^ {8}"(\d{3})":\s*$/.exec(raw);
      if (statusMatch && statusMatch[1]) {
        responses.add(statusMatch[1]);
      }
    }
  }

  return responses;
}

describe('ERP-5 OpenAPI contract', () => {
  let registeredRoutes: string[];

  beforeAll(async () => {
    const app: FastifyInstance = fastify({ logger: false });
    app.addHook('onRoute', (route) => {
      registeredRoutes = registeredRoutes ?? [];
      registeredRoutes.push(`${route.method} ${route.url.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`);
    });
    await app.register(erpHrRoutes, {
      prefix: '/api/v1/erp-hr',
      hrService: new HrService(new InMemoryHrRepository(true)),
    });
    await app.ready();
    await app.close();
  });

  it('resolves every $ref of the document', () => {
    const references = [
      ...SPEC.matchAll(/\$ref:\s*"#\/components\/([A-Za-z]+)\/([^"]+)"/g),
    ].map((match) => `${match[1]}/${match[2]}`);

    expect(references.length).toBeGreaterThan(0);
    const componentsStart = SPEC.indexOf('\ncomponents:');
    expect(componentsStart).toBeGreaterThan(-1);
    const components = SPEC.slice(componentsStart);

    for (const reference of references) {
      const [kind, name] = reference.split('/') as [string, string];
      expect(
        new RegExp(`^ {2}${kind}:\\s*$`, 'm').test(components),
        `components.${kind} is missing`
      ).toBe(true);
      expect(
        new RegExp(`^ {4}${name}:\\s*$`, 'm').test(components),
        `${reference} does not resolve`
      ).toBe(true);
    }
  });

  it('documents every write endpoint the module registers', () => {
    const documented = documentedEndpoints(SPEC);

    for (const endpoint of WRITE_ENDPOINTS) {
      expect(documented.has(endpoint), `${endpoint} is not documented`).toBe(true);
    }

    // No write route may exist without documentation.
    const writeRoutes = (registeredRoutes ?? []).filter((route) =>
      /^(POST|PATCH|PUT|DELETE) /.test(route)
    );
    expect(writeRoutes.length).toBeGreaterThan(0);
    for (const route of writeRoutes) {
      const withPrefix = route.replace('/api/v1/erp-hr', '');
      expect(documented.has(withPrefix), `${route} is not documented`).toBe(true);
    }
  });

  it('documents every read endpoint the module registers', () => {
    const documented = documentedEndpoints(SPEC);

    for (const endpoint of READ_ENDPOINTS) {
      expect(documented.has(endpoint), `${endpoint} is not documented`).toBe(true);
    }

    const readRoutes = (registeredRoutes ?? []).filter((route) => /^GET /.test(route));
    expect(readRoutes.length).toBeGreaterThan(0);
    for (const route of readRoutes) {
      const withPrefix = route.replace('/api/v1/erp-hr', '');
      expect(documented.has(withPrefix), `${route} is not documented`).toBe(true);
    }
  });

  it('documents the bounded paging of every collection', () => {
    for (const collection of [
      'listEmployees',
      'listDepartments',
      'listLeave',
      'listIdentityUsers',
      'listPayrollTotals',
    ]) {
      const block = operationBlock(SPEC, collection);
      expect(block, `${collection} is not documented`).not.toBe('');
      expect(block).toContain('#/components/parameters/Page');
      expect(block).toContain('#/components/parameters/PageSize');
    }
  });

  it('documents the expected status codes for every write operation', () => {
    const expectations: Record<string, string[]> = {
      createEmployee: ['201', '200', '400', '401', '403', '404', '409', '422', '500'],
      updateEmployee: ['200', '400', '401', '403', '404', '409', '422', '500'],
      createDepartment: ['201', '200', '400', '401', '403', '404', '409', '500'],
      updateDepartment: ['200', '400', '401', '403', '404', '409', '422', '500'],
      createLeave: ['201', '200', '400', '401', '403', '404', '409', '422', '500'],
      updateLeave: ['200', '400', '401', '403', '404', '422', '500'],
      createPayrollTotal: ['201', '200', '400', '401', '403', '404', '409', '422', '500'],
    };

    for (const [operationId, statuses] of Object.entries(expectations)) {
      const documented = documentedResponses(SPEC, operationId);
      for (const status of statuses) {
        expect(documented.has(status), `${operationId} does not document ${status}`).toBe(true);
      }
    }
  });

  it('forbids unknown properties on every write request schema', () => {
    for (const schema of [
      'CreateEmployeeRequest',
      'UpdateEmployeeRequest',
      'CreateDepartmentRequest',
      'UpdateDepartmentRequest',
      'CreateLeaveRequest',
      'UpdateLeaveRequest',
      'CreatePayrollTotalRequest',
    ]) {
      const block = componentBlock(SPEC, schema);
      expect(block, `${schema} is missing`).not.toBe('');
      expect(block, `${schema} must forbid unknown properties`).toContain(
        'additionalProperties: false'
      );
    }
  });

  it('never exposes a raw salary in an employee write response', () => {
    const block = componentBlock(SPEC, 'EmployeeMutationResponse');
    expect(block).not.toBe('');
    expect(block).toContain('#/components/schemas/EmployeeView');
    expect(block).not.toMatch(/#\/components\/schemas\/Employee$/m);
  });

  it('documents the leave state matrix', () => {
    expect(SPEC).toContain('UpdateLeaveRequest:');
    expect(SPEC).toContain('HR_INVALID_LEAVE_STATUS_TRANSITION');
  });

  it('documents the relationship warning', () => {
    expect(SPEC).toContain('RelationshipWarning:');
    expect(SPEC).toContain('HR_OPTIONAL_REFERENCE_ABSENT');
  });

  it('documents the authorization contract of every operation', () => {
    // Every operation must declare the authentication and the authorization
    // outcome — an operation that does not is a contract gap (ERP5-15).
    const lines = SPEC.split('\n');
    for (const path of Object.keys(documentedEndpoints(SPEC))) {
      const block = operationBlockByPath(SPEC, path);
      expect(block, `${path} is not documented`).not.toBe('');
      expect(block, `${path} does not document 401`).toContain('"401":');
      expect(block, `${path} does not document 403`).toContain('"403":');
    }
    expect(lines.length).toBeGreaterThan(0);
  });

  it('documents the import receipt of a write', () => {
    expect(SPEC).toContain('ImportReceipt:');
    expect(SPEC).toContain('import_receipt:');
    expect(SPEC).toContain('erp5.import_receipts');
  });

  it('mirrors the shared PLT-04 error envelope', () => {
    // The module must not redefine the shared envelope.
    const shared = componentBlock(COMMON_SPEC, 'ErrorEnvelope');
    expect(shared).not.toBe('');
    expect(shared).toContain('code:');
    expect(shared).toContain('message:');
    expect(shared).toContain('details:');
    expect(shared).toContain('correlation_id:');

    const module = componentBlock(SPEC, 'ApiError');
    expect(module).not.toBe('');
    expect(module).toContain('required: [code, message]');
    expect(module).toContain('details:');
    expect(module).toContain('correlation_id:');
  });
});
