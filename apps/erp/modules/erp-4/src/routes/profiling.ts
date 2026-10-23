/**
 * ERP-4 Finance & Accounting — Migration Profiling Routes (KIT-03 / ERP4-26)
 *
 * Exposes endpoints for data profiling, column quality inspection,
 * exact duplicate candidate review, and formula-safe CSV export.
 *
 * GET  /migration/profile        - Retrieve column profiling report for Dirty Data Pack
 * GET  /migration/profile/export - Download formula-safe CSV data health report
 * POST /migration/profile        - Run strictly non-destructive profile on arbitrary CSV payload
 *
 * @module erp4/routes/profiling
 */

import type { FastifyPluginAsync } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { requireFinancePolicy, FinancePolicies } from '../policies/index.js';
import {
  profileErp4Dataset,
  exportErp4ProfileCsv,
} from '../migration/profiling-config.js';
import { readRawRows } from '../migration/rules.js';

const ProfileUploadBodySchema = z.object({
  csvContent: z.string().min(1, 'csvContent must be non-empty'),
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

export const profilingRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /migration/profile - Retrieve profile for canonical dirty data pack
  fastify.get(
    '/migration/profile',
    { preHandler: [requireFinancePolicy(FinancePolicies.MIGRATION_PROFILE_READ)] },
    async (_request, reply) => {
      const csvText = loadCanonicalCsv();
      const rawRows = readRawRows(csvText);
      const rowsAsRecord = rawRows.map((r) => r as unknown as Record<string, string>);
      const report = profileErp4Dataset(rowsAsRecord, csvText);

      return reply.status(200).send({
        success: true,
        data: report,
      });
    }
  );

  // GET /migration/profile/export - Download formula-safe CSV Data Health Report
  fastify.get(
    '/migration/profile/export',
    { preHandler: [requireFinancePolicy(FinancePolicies.MIGRATION_PROFILE_READ)] },
    async (_request, reply) => {
      const csvText = loadCanonicalCsv();
      const rawRows = readRawRows(csvText);
      const rowsAsRecord = rawRows.map((r) => r as unknown as Record<string, string>);
      const report = profileErp4Dataset(rowsAsRecord, csvText);
      const csvReport = exportErp4ProfileCsv(report);

      return reply
        .status(200)
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="erp4-data-health-profile.csv"')
        .send(csvReport);
    }
  );

  // POST /migration/profile - Strictly non-destructive profiling on provided CSV text
  fastify.post(
    '/migration/profile',
    { preHandler: [requireFinancePolicy(FinancePolicies.MIGRATION_PROFILE_READ)] },
    async (request, reply) => {
      const parseResult = ProfileUploadBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: 'BAD_REQUEST',
          message: 'Invalid request body for profiling',
          details: parseResult.error.flatten(),
        });
      }

      const { csvContent } = parseResult.data;
      let rowsAsRecord: Record<string, string>[];
      try {
        const rawRows = readRawRows(csvContent);
        rowsAsRecord = rawRows.map((r) => r as unknown as Record<string, string>);
      } catch {
        rowsAsRecord = parseGenericCsv(csvContent);
      }

      const report = profileErp4Dataset(rowsAsRecord, csvContent);

      return reply.status(200).send({
        success: true,
        data: report,
      });
    }
  );
};
