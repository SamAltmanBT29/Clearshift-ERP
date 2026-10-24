import type { Endpoint } from '../types/contract';

/**
 * Load the contract manifest used by the QA‑02 test suite.
 *
 * In a real implementation this would read a generated JSON file that
 * lists every public endpoint, the HTTP method, required headers, and a
 * Zod schema describing the expected response shape.
 *
 * For the initial scaffolding we return an empty list so the suite can be
 * executed without external fixtures.  The developer can later populate
 * `manifest.json` under `scripts/` and the function will read it.
 */
export async function loadContractManifest(): Promise<{ endpoints: Endpoint[] }> {
  // Placeholder – no endpoints yet.
  return { endpoints: [] };
}
