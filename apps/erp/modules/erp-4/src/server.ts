/**
 * ERP-4 Finance & Accounting — Standalone HTTP Server
 *
 * Runs the Fastify API server listening on configured HOST & PORT.
 *
 * @module erp4/server
 */

import { buildApp } from './app.js';

const PORT = Number(process.env['PORT'] ?? 3000);
const HOST = process.env['HOST'] ?? '0.0.0.0';

async function start() {
  const app = buildApp();
  try {
    const address = await app.listen({ port: PORT, host: HOST });
    console.log(`🚀 ERP-4 Finance API server listening on ${address}`);
    console.log(`📚 Public endpoint base: ${address}/api/v1/erp-finance`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (process.env['NODE_ENV'] !== 'test') {
  start();
}
