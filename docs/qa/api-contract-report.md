# API Contract Report

This document explains how the **QA‑02 API security, schema & contract conformance suite** works.

## Overview
The suite lives in `tests/contracts/` and is executed via:
```
npm run contract:test
```
It validates every public endpoint against a **contract manifest** that describes:
- HTTP method
- Path
- Required headers (including auth role)
- Expected response shape (Zod schema)

The manifest is loaded by `scripts/contract-test-helper.ts`. In production this file will be generated from the OpenAPI spec or a custom contract JSON.

## Generated artefacts
- **Endpoint‑role matrix** (`contract-report.json`) – maps each endpoint to the roles that may access it.
- **CI metadata** – commit SHA, Node/NPM versions, and a checksum of the fixture data are printed to the console and can be persisted in CI logs.

## Running locally
1. Ensure the test database is refreshed:
   ```bash
   npm run db:reset
   ```
2. Start the API server (Docker compose) if not already running:
   ```bash
   npm run compose:up
   ```
3. Execute the contract suite:
   ```bash
   npm run contract:test
   ```

## Failure handling
- Any deviation from the declared schema fails the test with a clear diff.
- Validation errors, conflict (HTTP 409), and idempotency violations are asserted explicitly in the manifest.
- Safe error responses are enforced – stack traces must never be exposed.

## Traceability
All contract failures are linked to the originating issue (`#93`) and automatically uploaded to the CI pipeline for audit.
