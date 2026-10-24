import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../../cli/index.js';

describe('KIT-15 CLI', () => {
  let tmpDir: string;
  let csvPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cskit-'));
    process.env.CS_KIT_DATA_DIR = path.join(tmpDir, '.cs-kit');
    csvPath = path.join(tmpDir, 'data.csv');
    fs.writeFileSync(csvPath, 'id,name\n1,Alice\n2,Bob\n', 'utf8');
  });

  afterEach(() => {
    delete process.env.CS_KIT_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a batch', async () => {
    const io = { stdout: () => {}, stderr: () => {} };
    const code = await main(['batch', 'create', '--module', 'erp1', '--file', csvPath], io as any);
    expect(code).toBe(0);
  });

  it('runs all steps and reconciles', async () => {
    const out: string[] = [];
    const io = { stdout: (m: string) => out.push(m), stderr: () => {} };
    let code = await main(['batch', 'create', '--module', 'erp1', '--file', csvPath], io as any);
    expect(code).toBe(0);
    const idLine = out.find((l) => l.startsWith('Batch created:'));
    const id = idLine!.split(':')[1].trim();
    out.length = 0;
    code = await main(['run', '--batch', id, '--steps', 'extract,profile,clean,map,dry-run,load,validate,reconcile'], io as any);
    expect(code).toBe(0);
    expect(out.some((l) => l.includes('Reconciliation OK'))).toBe(true);
  });

  it('writes reconciliation report', async () => {
    const out: string[] = [];
    const io = { stdout: (m: string) => out.push(m), stderr: () => {} };
    await main(['batch', 'create', '--module', 'erp1', '--file', csvPath], io as any);
    const id = out.find((l) => l.startsWith('Batch created:'))!.split(':')[1].trim();
    await main(['run', '--batch', id, '--steps', 'extract,profile,clean,map,dry-run,load,validate,reconcile'], io as any);
    out.length = 0;
    const reportPath = path.join(tmpDir, 'report.csv');
    const code = await main(['report', 'reconcile', '--batch', id, '--out', reportPath], io as any);
    expect(code).toBe(0);
    const csv = fs.readFileSync(reportPath, 'utf8');
    expect(csv).toContain(id);
    expect(csv).toContain('OK');
  });

  it('returns nonzero for validation failure', async () => {
    const io = { stdout: () => {}, stderr: () => {} };
    const code = await main(['batch', 'create', '--module', 'nope', '--file', csvPath], io as any);
    expect(code).toBe(1);
  });

  it('returns nonzero for missing batch', async () => {
    const io = { stdout: () => {}, stderr: () => {} };
    const code = await main(['run', '--batch', 'B-99999', '--steps', 'extract'], io as any);
    expect(code).toBe(1);
  });
});
