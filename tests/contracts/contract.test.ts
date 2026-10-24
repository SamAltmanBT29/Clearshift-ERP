// Contract suite for API security & schema compliance (QA‑02)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// Using global fetch (Node >=18)
import { z } from 'zod';
import { loadContractManifest } from '../../scripts/contract-test-helper.js';

let manifest: ReturnType<typeof loadContractManifest>;

beforeAll(async () => {
  // Ensure the test DB is fresh – the CI pipeline runs `npm run db:reset` before tests.
  manifest = await loadContractManifest();
});

describe('API contract validation', () => {
  for (const endpoint of manifest.endpoints) {
    it(`${endpoint.method} ${endpoint.path} should conform to schema`, async () => {
      const url = `${process.env.API_BASE_URL ?? 'http://localhost:3000'}${endpoint.path}`;
      const resp = await fetch(url, { method: endpoint.method, headers: endpoint.headers });
      const json = await resp.json();
      const schema = z.object(endpoint.responseSchema);
      expect(resp.status).toBeLessThan(500);
      expect(() => schema.parse(json)).not.toThrow();
    });
  }
});
