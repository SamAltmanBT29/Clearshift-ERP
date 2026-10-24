/**
 * Contract test: Fastify implementation <-> packages/contracts/openapi/erp-1.yaml parity.
 *
 * Asserts:
 *   1. All baseline operations specified in SDS / Issue #15 are documented.
 *   2. All baseline operations are implemented in Fastify routes.
 *   3. Every implemented route is documented in OpenAPI.
 *   4. Every documented route is implemented (no phantom endpoints).
 *
 * @module erp1/tests/contract/openapi-parity
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

const PREFIX = '/api/v1/erp-products';
const YAML_PATH = resolve(__dirname, '../../../../../../packages/contracts/openapi/erp-1.yaml');

/** The 8 baseline operations named in Issue #15 technical specification. */
const BASELINE = [
  'GET /products',
  'POST /products',
  'PATCH /products/{id}',
  'GET /categories',
  'POST /categories',
  'PATCH /categories/{id}',
  'GET /stock',
  'POST /stock/opening',
];

function normalisePath(p: string): string {
  let out = p.trim().replace(/^['"]|['"]$/g, '');
  const i = out.indexOf('erp-products');
  if (i >= 0) out = out.slice(i + 'erp-products'.length);
  out = out.replace(/:([A-Za-z_]+)/g, '{$1}').replace(/\/+$/, '');
  return out === '' ? '/' : out;
}

function documentedOperations(): Set<string> {
  const lines = readFileSync(YAML_PATH, 'utf8').split('\n');
  const ops = new Set<string>();
  const start = lines.findIndex((l) => /^paths:\s*$/.test(l));
  if (start < 0) throw new Error(`No top-level "paths:" found in ${YAML_PATH}`);

  let pathIndent = -1;
  let current: string | null = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // Next top-level block
    const pathMatch = /^(\s+)(['"]?\/[^\s'"]*['"]?):\s*$/.exec(line);
    if (pathMatch?.[1] !== undefined && pathMatch[2]) {
      if (pathIndent < 0) pathIndent = pathMatch[1].length;
      if (pathMatch[1].length === pathIndent) {
        current = normalisePath(pathMatch[2]);
        continue;
      }
    }
    const methodMatch = /^(\s+)(get|post|patch|put|delete):\s*$/.exec(line);
    if (methodMatch?.[1] !== undefined && methodMatch[2] && current && pathIndent >= 0) {
      if (methodMatch[1].length > pathIndent) {
        ops.add(`${methodMatch[2].toUpperCase()} ${current}`);
      }
    }
  }
  return ops;
}

async function implementedOperations(): Promise<Set<string>> {
  const app = buildApp();
  const ops = new Set<string>();
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const m of methods) {
      if (m === 'HEAD' || m === 'OPTIONS') continue;
      if (route.url.startsWith(PREFIX)) {
        ops.add(`${m} ${normalisePath(route.url)}`);
      }
    }
  });
  await app.ready();
  await app.close();
  return ops;
}

describe('ERP-1 OpenAPI <-> Implementation Parity', () => {
  it('documents all 8 baseline operations from Issue #15', () => {
    const doc = documentedOperations();
    const missing = BASELINE.filter((b) => !doc.has(b));
    expect(missing, `Missing from erp-1.yaml: ${missing.join(', ')}`).toEqual([]);
  });

  it('implements all 8 baseline operations from Issue #15', async () => {
    const impl = await implementedOperations();
    const missing = BASELINE.filter((b) => !impl.has(b));
    expect(missing, `Not implemented in Fastify routes: ${missing.join(', ')}`).toEqual([]);
  });

  it('every implemented route is documented in OpenAPI', async () => {
    const impl = await implementedOperations();
    const doc = documentedOperations();
    const undocumented = [...impl].filter((o) => !doc.has(o)).sort();
    expect(undocumented, `Add to erp-1.yaml: ${undocumented.join(', ')}`).toEqual([]);
  });

  it('every documented route is implemented in Fastify routes (no phantom endpoints)', async () => {
    const impl = await implementedOperations();
    const doc = documentedOperations();
    const phantom = [...doc].filter((o) => !impl.has(o)).sort();
    expect(phantom, `Documented in OpenAPI but not implemented: ${phantom.join(', ')}`).toEqual([]);
  });
});
