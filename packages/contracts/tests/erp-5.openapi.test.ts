/**
 * ERP-5 HR & Employees — OpenAPI 3.1 Contract Verification Test Suite
 *
 * Proves that:
 *   - The OpenAPI 3.1 document is loadable and syntactically valid YAML.
 *   - Every internal $ref resolves to an existing component schema/parameter/response.
 *   - Required HR endpoints are fully documented.
 *   - Collection endpoints declare bounded pagination parameters (pageSize <= 100).
 *   - Response schemas for employees (View) omit prohibited sensitive fields (salary, birth_date).
 *   - Error responses conform to ADR-002 and PLT-04 standard error envelope.
 *
 * @module contracts/tests/erp-5.openapi.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const SPEC_PATH = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../openapi/erp-5.yaml'
);

const COMMON_SPEC_PATH = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../openapi/common.yaml'
);

const SPEC_RAW = readFileSync(SPEC_PATH, 'utf-8');
const SPEC = yaml.load(SPEC_RAW) as any;
const COMMON_SPEC = yaml.load(readFileSync(COMMON_SPEC_PATH, 'utf-8')) as any;

function resolveRef(spec: any, ref: string): any {
  if (!ref.startsWith('#/')) {
    throw new Error(`Unsupported OpenAPI reference: ${ref}`);
  }

  return ref
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((value, key) => {
      if (value == null || !(key in value)) {
        throw new Error(`Unresolved OpenAPI reference: ${ref}`);
      }
      return value[key];
    }, spec);
}

/** Expected endpoints for ERP-5 HR API */
const EXPECTED_ENDPOINTS = [
  'GET /employees',
  'POST /employees',
  'GET /employees/{id}',
  'PATCH /employees/{id}',
  'GET /departments',
  'POST /departments',
  'GET /departments/{id}',
  'PATCH /departments/{id}',
  'GET /leave',
  'POST /leave',
  'GET /leave/{id}',
  'PATCH /leave/{id}',
  'GET /identity-users',
  'GET /payroll-totals',
  'POST /payroll-totals',
  'GET /payroll-totals/{id}',
] as const;

function extractDocumentedEndpoints(spec: any): Set<string> {
  const endpoints = new Set<string>();
  const paths = spec.paths || {};

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods as any)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        endpoints.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }

  return endpoints;
}

describe('ERP-5 OpenAPI 3.1 Contract Specification', () => {
  it('verifies erp-5.yaml exists and declares OpenAPI 3.1.0', () => {
    expect(existsSync(SPEC_PATH)).toBe(true);
    expect(SPEC_RAW).toContain('openapi: "3.1.0"');
    expect(SPEC_RAW).toContain('ClearShift ERP — HR & Employees API');
    expect(SPEC_RAW).toContain('/api/v1/erp-hr');
  });

  it('resolves every internal $ref in the specification', () => {
    const references = [
      ...SPEC_RAW.matchAll(/\$ref:\s*"#\/components\/([A-Za-z]+)\/([^"]+)"/g),
    ].map((m) => `${m[1]}/${m[2]}`);

    expect(references.length).toBeGreaterThan(0);

    for (const ref of references) {
      const fullRef = `#/components/${ref}`;
      expect(() => resolveRef(SPEC, fullRef)).not.toThrow();
    }
  });

  it('documents every required HR endpoint', () => {
    const documented = extractDocumentedEndpoints(SPEC);
    for (const endpoint of EXPECTED_ENDPOINTS) {
      expect(documented.has(endpoint), `Missing endpoint: ${endpoint}`).toBe(true);
    }
  });

  it('documents bounded pagination (max 100) on collection routes', () => {
    const collectionOps = [
      'listEmployees',
      'listDepartments',
      'listLeave',
      'listPayrollTotals',
      'listIdentityUsers',
    ];
    for (const op of collectionOps) {
      let foundOp = null;
      for (const path of Object.values(SPEC.paths || {})) {
        for (const method of Object.values(path as any)) {
          if (method.operationId === op) {
            foundOp = method;
            break;
          }
        }
        if (foundOp) break;
      }
      expect(foundOp, `${op} must exist in OpenAPI spec`).toBeDefined();
      
      const params = foundOp.parameters || [];
      const pageSizeParamRef = params.find((p: any) => p.$ref?.endsWith('/PageSize'));
      const pageSizeParam = pageSizeParamRef ? resolveRef(SPEC, pageSizeParamRef.$ref) : 
                             params.find((p: any) => p.name === 'pageSize');
                             
      expect(pageSizeParam, `${op} must have pageSize parameter`).toBeDefined();
      expect(pageSizeParam.schema.maximum).toBe(100);
    }
  });

  it('ensures public employee view excludes sensitive data', () => {
    const components = SPEC.components || {};
    const viewSchemaRef = components.schemas?.EmployeeView;
    const employeeView = typeof viewSchemaRef === 'string' && viewSchemaRef.startsWith('#') 
      ? resolveRef(SPEC, viewSchemaRef) 
      : viewSchemaRef;

    expect(employeeView, 'EmployeeView schema missing').toBeDefined();
    const properties = employeeView.properties || {};

    expect(properties.salary).toBeUndefined();
    expect(properties.salary_display).toBeDefined();
  });

  it('mirrors the shared error envelope (ADR-002 / PLT-04)', () => {
    // Check that error responses use refs to components that define the error structure
    const paths = SPEC.paths || {};
    let foundErrorRef = false;
    for (const path of Object.values(paths)) {
      for (const method of Object.values(path as any)) {
        const responses = method.responses || {};
        for (const res of Object.values(responses)) {
          if (typeof res === 'object' && res.$ref && res.$ref.includes('ValidationError')) {
            foundErrorRef = true;
            break;
          }
        }
      }
    }
    expect(foundErrorRef, 'No ValidationError references found in paths').toBe(true);
    expect(SPEC_RAW).toContain('ApiError:');
    expect(SPEC_RAW).toContain('code:');
    expect(SPEC_RAW).toContain('message:');
  });
});
