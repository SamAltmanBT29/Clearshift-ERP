import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('DevOps & Infrastructure Baseline (Issue #57 / [PLT-02])', () => {
  const rootDir = resolve(__dirname, '../../..');

  it('verifies infra/compose.yaml exists with pinned service tags and healthchecks', () => {
    const composePath = resolve(rootDir, 'infra/compose.yaml');
    expect(existsSync(composePath)).toBe(true);

    const composeContent = readFileSync(composePath, 'utf8');

    // Pinned image tags (Constraint: non-negotiable)
    expect(composeContent).toContain('postgres:18.6-alpine');
    expect(composeContent).toContain('redis:8.10.1-alpine');

    // Healthchecks for both services
    expect(composeContent).toContain('pg_isready');
    expect(composeContent).toContain('redis-cli ping');

    // Persistent named volumes
    expect(composeContent).toContain('postgres_data:');
    expect(composeContent).toContain('redis_data:');

    // Isolated bridge network
    expect(composeContent).toContain('clearshift_network:');
  });

  it('verifies controlled migration script exists and exports runMigrations', async () => {
    const migrateScriptPath = resolve(rootDir, 'infra/scripts/db-migrate.ts');
    expect(existsSync(migrateScriptPath)).toBe(true);

    const module = await import(migrateScriptPath);
    expect(typeof module.runMigrations).toBe('function');
  });

  it('verifies synthetic seeder script exists and exports seedDatabase', async () => {
    const seedScriptPath = resolve(rootDir, 'infra/scripts/seed.ts');
    expect(existsSync(seedScriptPath)).toBe(true);

    const module = await import(seedScriptPath);
    expect(typeof module.seedDatabase).toBe('function');
  });

  it('verifies package.json provides compose and db lifecycle scripts', () => {
    const packageJsonPath = resolve(rootDir, 'package.json');
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

    expect(pkg.scripts['compose:up']).toBeDefined();
    expect(pkg.scripts['compose:down']).toBeDefined();
    expect(pkg.scripts['db:migrate']).toBeDefined();
    expect(pkg.scripts['db:seed']).toBeDefined();
    expect(pkg.scripts['db:reset']).toBeDefined();
  });

  it('verifies .env.example contains only synthetic templates and no secrets', () => {
    const envExamplePath = resolve(rootDir, '.env.example');
    expect(existsSync(envExamplePath)).toBe(true);

    const envContent = readFileSync(envExamplePath, 'utf8');
    expect(envContent).toContain('POSTGRES_USER=cs_app');
    expect(envContent).toContain('POSTGRES_DB=clearshift');
    expect(envContent).toContain('DATABASE_URL=');
    expect(envContent).toContain('DATABASE_MIGRATOR_URL=');
    expect(envContent).toContain('REDIS_URL=');

    // Ensure no real private keys or production secrets
    const rsaMarker = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
    expect(envContent).not.toContain(rsaMarker);
    expect(envContent).not.toContain('-----BEGIN PRIVATE KEY-----');
  });

  it('verifies docs/runbooks/local-dev.md documents clean-clone walkthrough', () => {
    const runbookPath = resolve(rootDir, 'docs/runbooks/local-dev.md');
    expect(existsSync(runbookPath)).toBe(true);

    const content = readFileSync(runbookPath, 'utf8');
    expect(content).toContain('compose:up');
    expect(content).toContain('db:migrate');
    expect(content).toContain('db:seed');
    expect(content).toContain('db:reset');
    expect(content).toContain('PostgreSQL');
    expect(content).toContain('Redis');
  });
});
