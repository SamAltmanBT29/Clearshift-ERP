/**
 * ERP-4 Finance & Accounting — Migration Cleaning Routes (KIT-04 / ERP4-27)
 *
 * Exposes endpoints for executing module cleaning rules, inspecting transformed rows,
 * viewing field-level change audits, and downloading formula-safe CSV audit reports.
 *
 * GET  /migration/clean              - Clean canonical Dirty Data Pack fixture
 * GET  /migration/clean/audit/export - Download formula-safe CSV field-level audit log
 * POST /migration/clean              - Clean arbitrary CSV payload with optional rule toggles
 *
 * @module erp4/routes/cleaning
 */

import type { FastifyPluginAsync } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { requireFinancePolicy, FinancePolicies } from '../policies/index.js';
import {
  cleanErp4Dataset,
  exportErp4FieldAuditCsv,
} from '../migration/cleaning-config.js';
import { readRawRows } from '../migration/rules.js';

const CleanUploadBodySchema = z.object({
  csvContent: z.string().min(1, 'csvContent must be non-empty'),
  enabledRuleIds: z.array(z.string()).optional(),
});

// Locate canonical Dirty Data Pack fixture
const REPO_ROOT = resolve(process.cwd());
const CANONICAL_CSV_PATH = resolve(REPO_ROOT, 'sample-data/erp-4/dirty-data-v1.csv');

function loadCanonicalCsv(): string {
  return readFileSync(CANONICAL_CSV_PATH, 'utf8');
}

/**
 * Parses generic delimited CSV lines into string records when not matching fixture layout.
 */
function parseGenericCsv(csvText: string): Record<string, string>[] {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0]!.includes(';') ? ';' : ',';
  const headers = lines[0]!.split(delimiter).map((h) => h.replace(/^["']|["']$/g, '').trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(delimiter).map((c) => c.replace(/^["']|["']$/g, '').trim());
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j] || `col_${j + 1}`;
      obj[h] = cells[j] ?? '';
    }
    rows.push(obj);
  }
  return rows;
}

export const cleaningRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /migration/clean - Clean canonical Dirty Data Pack with default rules
  fastify.get(
    '/migration/clean',
    { preHandler: [requireFinancePolicy(FinancePolicies.MIGRATION_CLEAN_READ)] },
    async (_request, reply) => {
      const csvText = loadCanonicalCsv();
      const rawRows = readRawRows(csvText);
      const rowsAsRecord = rawRows.map((r) => r as unknown as Record<string, string>);
      const report = cleanErp4Dataset(rowsAsRecord);

      return reply.status(200).send({
        success: true,
        data: report,
      });
    }
  );

  // GET /migration/clean/audit/export - Download formula-safe CSV field-level audit log
  fastify.get(
    '/migration/clean/audit/export',
    { preHandler: [requireFinancePolicy(FinancePolicies.MIGRATION_CLEAN_READ)] },
    async (_request, reply) => {
      const csvText = loadCanonicalCsv();
      const rawRows = readRawRows(csvText);
      const rowsAsRecord = rawRows.map((r) => r as unknown as Record<string, string>);
      const report = cleanErp4Dataset(rowsAsRecord);
      const csvReport = exportErp4FieldAuditCsv(report.audits);

      return reply
        .status(200)
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="erp4-field-clean-audit.csv"')
        .send(csvReport);
    }
  );

  // POST /migration/clean - Execute cleaning on provided CSV with optional rule toggles
  fastify.post(
    '/migration/clean',
    { preHandler: [requireFinancePolicy(FinancePolicies.MIGRATION_CLEAN_RUN)] },
    async (request, reply) => {
      const parseResult = CleanUploadBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'BAD_REQUEST',
          message: 'Invalid request body for cleaning',
          details: parseResult.error.flatten(),
        });
      }

      const { csvContent, enabledRuleIds } = parseResult.data;
      let rowsAsRecord: Record<string, string>[];
      try {
        const rawRows = readRawRows(csvContent);
        rowsAsRecord = rawRows.map((r) => r as unknown as Record<string, string>);
      } catch {
        rowsAsRecord = parseGenericCsv(csvContent);
      }

      const report = cleanErp4Dataset(rowsAsRecord, enabledRuleIds);

      return reply.status(200).send({
        success: true,
        data: report,
      });
    }
  );
};
