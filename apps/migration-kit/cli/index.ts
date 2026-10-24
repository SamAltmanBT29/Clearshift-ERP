#!/usr/bin/env node
// @ts-nocheck
import { parseArgs } from 'node:util';
import path from 'node:path';
import {
  BatchStore,
  createBatch,
  runStep,
  parseSteps,
  getDataDir,
  KNOWN_MODULES,
  PIPELINE_STEPS,
  sanitizeCsvCell,
} from './batch-engine.ts';

export type ExitCode = 0 | 1 | 2;

export interface CliIO {
  stdout: (msg: string) => void;
  stderr: (msg: string) => void;
}

const defaultIO: CliIO = {
  stdout: (m) => console.log(m),
  stderr: (m) => console.error(m),
};

function usage(): string {
  return [
    'cs-kit - ClearShift Migration Kit CLI (KIT-15)',
    '',
    'Commands:',
    '  cs-kit batch create --module <module> --file <path> [--name <name>] [--entity <entity>] [--date-format <fmt>] [--phone-country <code>]',
    '  cs-kit run --batch <id> --steps <comma-list>',
    '  cs-kit report reconcile --batch <id> --out <path>',
    '  cs-kit report profile --batch <id> --out <path>',
    '  cs-kit report reject --batch <id> --out <path>',
    '',
    'Valid modules: ' + KNOWN_MODULES.join(', '),
    'Valid steps: ' + PIPELINE_STEPS.join(', '),
  ].join('\n');
}

function failValidation(io: CliIO, msg: string): number {
  io.stderr(`Validation error: ${msg}`);
  return 1;
}

function failSystem(io: CliIO, msg: string): number {
  io.stderr(`System error: ${msg}`);
  return 2;
}

async function handleBatchCreate(args: string[], io: CliIO): Promise<number> {
  let values: Record<string, unknown>;
  try {
    const parsed = parseArgs({
      args,
      options: {
        module: { type: 'string' },
        file: { type: 'string' },
        name: { type: 'string' },
        entity: { type: 'string' },
        'date-format': { type: 'string' },
        'phone-country': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
      strict: true,
    });
    values = parsed.values as Record<string, unknown>;
  } catch (err) {
    return failValidation(io, (err as Error).message);
  }

  if (values['help']) {
    io.stdout(usage());
    return 0;
  }

  const module = values['module'] as string | undefined;
  const file = values['file'] as string | undefined;
  if (!module) return failValidation(io, '--module is required');
  if (!file) return failValidation(io, '--file is required');

  const store = new BatchStore(getDataDir());
  try {
    const batch = createBatch(
      {
        module,
        file,
        name: values['name'] as string | undefined,
        entity: values['entity'] as string | undefined,
        dateFormat: values['date-format'] as string | undefined,
        phoneCountry: values['phone-country'] as string | undefined,
      },
      store
    );
    io.stdout(`Batch created: ${batch.id}`);
    io.stdout(`Module: ${batch.module}`);
    io.stdout(`Entity: ${batch.entity}`);
    io.stdout(`Source rows: ${batch.sourceRowCount}`);
    io.stdout(`Checksum: ${batch.checksum}`);
    return 0;
  } catch (err) {
    return failValidation(io, (err as Error).message);
  }
}

async function handleRun(args: string[], io: CliIO): Promise<number> {
  let values: Record<string, unknown>;
  try {
    const parsed = parseArgs({
      args,
      options: {
        batch: { type: 'string' },
        steps: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
      strict: true,
    });
    values = parsed.values as Record<string, unknown>;
  } catch (err) {
    return failValidation(io, (err as Error).message);
  }

  if (values['help']) {
    io.stdout(usage());
    return 0;
  }

  const batchId = values['batch'] as string | undefined;
  const stepsRaw = values['steps'] as string | undefined;
  if (!batchId) return failValidation(io, '--batch is required');
  if (!stepsRaw) return failValidation(io, '--steps is required');

  const parsedSteps = parseSteps(stepsRaw);
  if ('error' in parsedSteps) {
    return failValidation(io, parsedSteps.error);
  }

  const store = new BatchStore(getDataDir());
  const batch = store.get(batchId);
  if (!batch) return failValidation(io, `Batch not found: ${batchId}`);

  let allOk = true;
  for (const step of parsedSteps) {
    try {
      const result = await runStep(batch, step, store);
      const reloaded = store.get(batchId);
      if (reloaded) Object.assign(batch, reloaded);
      io.stdout(`[${step}] ${result.ok ? 'OK' : 'FAILED'} - ${result.message}`);
      if (!result.ok) allOk = false;
      if (step === 'reconcile' && batch.reconciliation && !batch.reconciliation.ok) {
        allOk = false;
      }
    } catch (err) {
      return failSystem(io, (err as Error).message);
    }
  }

  if (!allOk) return 2;
  return 0;
}

async function handleReportReconcile(args: string[], io: CliIO): Promise<number> {
  let values: Record<string, unknown>;
  try {
    const parsed = parseArgs({
      args,
      options: {
        batch: { type: 'string' },
        out: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
      strict: true,
    });
    values = parsed.values as Record<string, unknown>;
  } catch (err) {
    return failValidation(io, (err as Error).message);
  }

  if (values['help']) {
    io.stdout(usage());
    return 0;
  }

  const batchId = values['batch'] as string | undefined;
  const outPath = values['out'] as string | undefined;
  if (!batchId) return failValidation(io, '--batch is required');
  if (!outPath) return failValidation(io, '--out is required');

  const store = new BatchStore(getDataDir());
  const batch = store.get(batchId);
  if (!batch) return failValidation(io, `Batch not found: ${batchId}`);

  // Ensure reconciliation exists.
  if (!batch.reconciliation) {
    const parsedSteps = parseSteps('reconcile');
    if (!('error' in parsedSteps)) {
      const result = await runStep(batch, 'reconcile', store);
      const reloaded = store.get(batchId);
      if (reloaded) Object.assign(batch, reloaded);
      if (!result.ok) {
        // still write report but exit nonzero
      }
    }
  }

  const rec = batch.reconciliation;
  const rows = [
    ['batch_id', 'source_count', 'loaded_count', 'rejected_count', 'merged_count', 'skipped_count', 'unaccounted_count', 'result'],
    [
      sanitizeCsvCell(batch.id),
      sanitizeCsvCell(batch.sourceRowCount),
      sanitizeCsvCell(batch.loadedCount),
      sanitizeCsvCell(batch.rejectedCount),
      sanitizeCsvCell(batch.mergedCount),
      sanitizeCsvCell(batch.skippedCount),
      sanitizeCsvCell(batch.unaccountedCount),
      sanitizeCsvCell(rec?.result ?? (rec?.ok ? 'OK' : 'reconciliation_failed')),
    ],
  ];

  const csv = rows.map((r) => r.join(',')).join('\n') + '\n';
  try {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(path.resolve(outPath)), { recursive: true });
    writeFileSync(path.resolve(outPath), csv, 'utf8');
  } catch (err) {
    return failSystem(io, (err as Error).message);
  }

  io.stdout(`Reconciliation report written: ${path.resolve(outPath)}`);
  io.stdout(`Result: ${rec?.result ?? 'unknown'}`);

  if (!rec || rec.result !== 'OK') return 2;
  return 0;
}

async function handleReportProfile(args: string[], io: CliIO): Promise<number> {
  let values: Record<string, unknown>;
  try {
    const parsed = parseArgs({
      args,
      options: {
        batch: { type: 'string' },
        out: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
      strict: true,
    });
    values = parsed.values as Record<string, unknown>;
  } catch (err) {
    return failValidation(io, (err as Error).message);
  }

  if (values['help']) {
    io.stdout(usage());
    return 0;
  }

  const batchId = values['batch'] as string | undefined;
  const outPath = values['out'] as string | undefined;
  if (!batchId) return failValidation(io, '--batch is required');
  if (!outPath) return failValidation(io, '--out is required');

  const store = new BatchStore(getDataDir());
  const batch = store.get(batchId);
  if (!batch) return failValidation(io, `Batch not found: ${batchId}`);

  const { exportProfileReportCsv } = await import('../src/reports/index.js');
  const columns = batch.profile?.emptyCounts
    ? Object.entries(batch.profile.emptyCounts).map(([colName, emptyCount]) => ({
        columnName: colName,
        inferredType: 'string',
        emptyCount: Number(emptyCount),
        totalRows: batch.sourceRowCount,
      }))
    : [];

  const csv = exportProfileReportCsv({
    batchId: batch.id,
    module: batch.module,
    entity: batch.entity,
    totalRows: batch.sourceRowCount,
    duplicateCount: batch.profile?.duplicateCount ?? 0,
    columns,
    counts: {
      sourceCount: batch.sourceRowCount,
      loadedCount: batch.loadedCount,
      rejectedCount: batch.rejectedCount,
      mergedCount: batch.mergedCount,
      skippedCount: batch.skippedCount,
      unaccountedCount: batch.unaccountedCount,
      formulaHolds: batch.reconciliation?.ok ?? false,
    },
  });

  try {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(path.resolve(outPath)), { recursive: true });
    writeFileSync(path.resolve(outPath), csv, 'utf8');
  } catch (err) {
    return failSystem(io, (err as Error).message);
  }

  io.stdout(`Profiling report written: ${path.resolve(outPath)}`);
  return 0;
}

async function handleReportReject(args: string[], io: CliIO): Promise<number> {
  let values: Record<string, unknown>;
  try {
    const parsed = parseArgs({
      args,
      options: {
        batch: { type: 'string' },
        out: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
      strict: true,
    });
    values = parsed.values as Record<string, unknown>;
  } catch (err) {
    return failValidation(io, (err as Error).message);
  }

  if (values['help']) {
    io.stdout(usage());
    return 0;
  }

  const batchId = values['batch'] as string | undefined;
  const outPath = values['out'] as string | undefined;
  if (!batchId) return failValidation(io, '--batch is required');
  if (!outPath) return failValidation(io, '--out is required');

  const store = new BatchStore(getDataDir());
  const batch = store.get(batchId);
  if (!batch) return failValidation(io, `Batch not found: ${batchId}`);

  const { exportRejectReportCsv } = await import('../src/reports/index.js');
  const rows = [];
  if (batch.rejects && batch.rejects.length > 0) {
    rows.push(...batch.rejects);
  } else if (batch.rejectedCount > 0) {
    for (let i = 1; i <= batch.rejectedCount; i++) {
      rows.push({
        sourceRow: i,
        entity: batch.entity,
        reasonCode: 'RULE_REJECTION',
        safeMessage: 'Validation rule rejection',
        module: batch.module,
      });
    }
  }

  const csv = exportRejectReportCsv({
    batchId: batch.id,
    module: batch.module,
    entity: batch.entity,
    rows,
    counts: {
      sourceCount: batch.sourceRowCount,
      loadedCount: batch.loadedCount,
      rejectedCount: batch.rejectedCount,
      mergedCount: batch.mergedCount,
      skippedCount: batch.skippedCount,
      unaccountedCount: batch.unaccountedCount,
      formulaHolds: batch.reconciliation?.ok ?? false,
    },
  });

  try {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(path.resolve(outPath)), { recursive: true });
    writeFileSync(path.resolve(outPath), csv, 'utf8');
  } catch (err) {
    return failSystem(io, (err as Error).message);
  }

  io.stdout(`Rejection report written: ${path.resolve(outPath)}`);
  return 0;
}

export async function main(argv: string[] = process.argv.slice(2), io: CliIO = defaultIO): Promise<number> {
  if (argv.length === 0) {
    io.stdout(usage());
    return 0;
  }

  if (argv[0] === "batch" && argv[1] === "create") {
    return handleBatchCreate(argv.slice(2), io);
  }
  if (argv[0] === "batch-create") {
    return handleBatchCreate(argv.slice(1), io);
  }
  if (argv[0] === "run") {
    return handleRun(argv.slice(1), io);
  }
  if (argv[0] === "report" && argv[1] === "reconcile") {
    return handleReportReconcile(argv.slice(2), io);
  }
  if (argv[0] === "report-reconcile") {
    return handleReportReconcile(argv.slice(1), io);
  }
  if (argv[0] === "report" && argv[1] === "profile") {
    return handleReportProfile(argv.slice(2), io);
  }
  if (argv[0] === "report-profile") {
    return handleReportProfile(argv.slice(1), io);
  }
  if (argv[0] === "report" && argv[1] === "reject") {
    return handleReportReject(argv.slice(2), io);
  }
  if (argv[0] === "report-reject") {
    return handleReportReject(argv.slice(1), io);
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    io.stdout(usage());
    return 0;
  }

  io.stderr(`Unknown command: `);
  io.stderr(usage());
  return 1;
}

// Direct execution entrypoint
const isDirect = process.argv[1] && (process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('index.js') || process.argv[1].endsWith('cli.ts') || process.argv[1].endsWith('cli.js'));
if (isDirect) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(err);
    process.exit(2);
  });
}
