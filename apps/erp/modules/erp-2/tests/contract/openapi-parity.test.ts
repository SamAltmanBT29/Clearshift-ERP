/**
 * Contract test: implemented Fastify routes <-> packages/contracts/openapi/erp-2.yaml.
 * Fails with a readable list if a route is undocumented or a documented route does not exist.
 * Line based on purpose: no extra YAML dependency needed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

const PREFIX = '/api/v1/erp-vendors';
const YAML_PATH = resolve(__dirname, '../../../../../../packages/contracts/openapi/erp-2.yaml');

/** The 7 operations named in the issue's contract baseline. */
const BASELINE = [
  'GET /vendors',
  'POST /vendors',
  'PATCH /vendors/{id}',
  'GET /purchase-orders',
  'GET /purchase-orders/{id}',
  'POST /purchase-orders',
  'PATCH /purchase-orders/{id}',
];

function normalisePath(p: string): string {
  let out = p.trim().replace(/^['"]|['"]$/g, '');
  const i = out.indexOf('erp-vendors');
  if (i >= 0) out = out.slice(i + 'erp-vendors'.length);
  out = out.replace(/:([A-Za-z_]+)/g, '{$1}').replace(/\/+$/, '');
  return out === '' ? '/' : out;
}

function documentedOperations(): Set<string> {
  const lines = readFileSync(YAML_PATH, 'utf8').split('\n');
  const ops = new Set<string>();
  const start = lines.findIndex((l) => /^paths:\s*$/.test(l));
  if (start < 0) throw new Error(`No top-level "paths:" in ${YAML_PATH}`);

  let pathIndent = -1;
  let current: string | null = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // next top-level key
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
      if (methodMatch[1].length > pathIndent) ops.add(`${methodMatch[2].toUpperCase()} ${current}`);
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
      if (route.url.startsWith(PREFIX)) ops.add(`${m} ${normalisePath(route.url)}`);
    }
  });
  await app.ready();
  await app.close();
  return ops;
}

describe('ERP-2 OpenAPI <-> implementation parity', () => {
  it('documents the 7 baseline operations from the issue', () => {
    const doc = documentedOperations();
    const missing = BASELINE.filter((b) => !doc.has(b));
    expect(missing, `Missing from erp-2.yaml: ${missing.join(', ')}`).toEqual([]);
  });

  it('implements the 7 baseline operations from the issue', async () => {
    const impl = await implementedOperations();
    const missing = BASELINE.filter((b) => !impl.has(b));
    expect(missing, `Not implemented: ${missing.join(', ')}`).toEqual([]);
  });

  it('every implemented route is documented (natural REST endpoints must be added to OpenAPI)', async () => {
    const impl = await implementedOperations();
    const doc = documentedOperations();
    const undocumented = [...impl].filter((o) => !doc.has(o)).sort();
    expect(undocumented, `Add to erp-2.yaml: ${undocumented.join(', ')}`).toEqual([]);
  });

  it('every documented route is implemented (no phantom endpoints)', async () => {
    const impl = await implementedOperations();
    const doc = documentedOperations();
    const phantom = [...doc].filter((o) => !impl.has(o)).sort();
    expect(phantom, `Documented but not implemented: ${phantom.join(', ')}`).toEqual([]);
  });

  it('V1 exposes no DELETE or PUT (no cancellation, no hard delete)', async () => {
    const impl = await implementedOperations();
    expect([...impl].filter((o) => /^(DELETE|PUT) /.test(o))).toEqual([]);
  });
});
