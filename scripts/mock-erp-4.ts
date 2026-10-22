/**
 * Standalone Deterministic Mock Server Runner for ERP-4 Finance & Accounting
 *
 * Runs the deterministic ERP-4 mock API server on port 4014 (or process.env.PORT)
 * for dependent workstreams (ERP-2, ERP-3, ERP-5, CRM-5) and Prism contract audits.
 *
 * Usage:
 *   node --experimental-strip-types scripts/mock-erp-4.ts
 */

import { createErp4MockServer, ERP4_MOCK_DEFAULT_PORT } from '../packages/contracts/src/erp-4-mock.js';

const port = Number(process.env.PORT ?? process.env.ERP4_MOCK_PORT ?? ERP4_MOCK_DEFAULT_PORT);
const host = process.env.HOST ?? '0.0.0.0';

const server = createErp4MockServer({
  authRequired: false,
});

async function main() {
  try {
    const url = await server.start(port, host);
    console.log(`🚀 [ERP-4 Mock Contract Server] running at ${url}`);
    console.log(`📋 Available endpoints:`);
    console.log(`   - GET/POST  /api/v1/erp-finance/accounts`);
    console.log(`   - GET/PATCH /api/v1/erp-finance/accounts/:id`);
    console.log(`   - GET/POST  /api/v1/erp-finance/journal-entries`);
    console.log(`   - GET/PATCH /api/v1/erp-finance/journal-entries/:id`);
    console.log(`   - POST      /api/v1/erp-finance/journal-entries/:id/post`);
    console.log(`   - POST      /api/v1/erp-finance/journal-entries/:id/reverse`);
    console.log(`   - POST      /api/v1/erp-finance/journal-entries/:id/void`);
    console.log(`   - GET       /api/v1/erp-finance/trial-balance?period=YYYY-MM`);
    console.log(`   - GET/POST  /api/v1/erp-finance/opening-balances`);
    console.log(`   - GET/PATCH /api/v1/erp-finance/periods`);
    console.log(`   - GET/PATCH /api/v1/erp-finance/periods/:id`);
    console.log(`💡 Press Ctrl+C to stop.`);
  } catch (err) {
    console.error('Failed to start ERP-4 mock server:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Stopping ERP-4 mock server...');
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.stop();
  process.exit(0);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
