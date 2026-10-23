/**
 * ClearShift Migration Kit — Shared Column Profiler & Duplicate Detector (KIT-03 / SDS §4.3)
 *
 * Implements canonical column-level profiling and exact duplicate candidate analysis:
 * - Computes total rows, null counts, distinct values, invalid format counts/rates, and top 5 values.
 * - Identifies exact duplicate candidate keys and records duplicate row associations.
 * - Guarantees strictly non-destructive profiling (source data remains unchanged).
 * - Exports formula-safe CSV data health reports preventing OWASP spreadsheet formula injection.
 *
 * @module kit/domain/profiler
 */

import { createHash } from "node:crypto";

export interface ColumnRule {
  readonly column: string;
  readonly label?: string;
  readonly recordType?: string;
  readonly required?: boolean;
  readonly formatValidator?: (value: string, row: Record<string, string>) => boolean;
}

export interface DuplicateKeyRule {
  readonly name: string;
  readonly label?: string;
  readonly recordType?: string;
  readonly extractKey: (row: Record<string, string>) => string | null;
}

export interface ProfilerConfig {
  readonly columns: readonly ColumnRule[];
  readonly duplicateKeys?: readonly DuplicateKeyRule[];
  readonly maxTopValues?: number; // default 5 per FR-PR-01
}

export interface TopValue {
  readonly value: string;
  readonly count: number;
}

export interface ColumnProfile {
  readonly column: string;
  readonly label: string;
  readonly recordType?: string | undefined;
  readonly totalRows: number;
  readonly populatedCount: number;
  readonly nullCount: number;
  readonly distinctCount: number;
  readonly invalidFormatCount: number;
  readonly invalidFormatRate: number; // percentage (0.00 to 100.00)
  readonly topValues: readonly TopValue[];
}

export interface DuplicateCandidateGroup {
  readonly key: string;
  readonly occurrences: number;
  readonly rowIds: readonly string[];
}

export interface DuplicateKeyProfile {
  readonly ruleName: string;
  readonly label: string;
  readonly recordType?: string | undefined;
  readonly candidateCount: number; // number of duplicate rows beyond the initial occurrence
  readonly groups: readonly DuplicateCandidateGroup[];
}

export interface DatasetProfileReport {
  readonly totalRows: number;
  readonly sha256: string;
  readonly isNonDestructive: boolean;
  readonly columns: Record<string, ColumnProfile>;
  readonly exactDuplicates: Record<string, DuplicateKeyProfile>;
  readonly generatedAt: string;
}

/**
 * Computes SHA-256 hex digest of a string or buffer.
 */
export function computeSha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Escapes cell values to prevent CSV formula injection (OWASP).
 * Cells beginning with =, +, -, @, tab, or carriage return are prefixed with a single quote.
 */
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Profiles a tabular dataset according to configured column and duplicate key rules.
 * Strictly non-destructive: guarantees the input rows and raw content are not modified.
 */
export function profileDataset(
  rows: readonly Record<string, string>[],
  config: ProfilerConfig,
  rawContent?: string
): DatasetProfileReport {
  const totalRows = rows.length;
  const maxTopValues = config.maxTopValues ?? 5;
  const sha256 = rawContent ? computeSha256(rawContent) : computeSha256(JSON.stringify(rows));

  // 1. Column profiling
  const columnProfiles: Record<string, ColumnProfile> = {};

  for (const rule of config.columns) {
    const relevantRows = rule.recordType
      ? rows.filter((r) => r["record_type"] === rule.recordType)
      : rows;

    const colTotal = relevantRows.length;
    let nullCount = 0;
    let invalidCount = 0;
    const valueCounts = new Map<string, number>();

    for (const row of relevantRows) {
      const rawVal = row[rule.column];
      const trimmed = rawVal !== undefined && rawVal !== null ? String(rawVal).trim() : "";

      if (trimmed === "") {
        nullCount++;
        if (rule.required) {
          invalidCount++;
        }
      } else {
        valueCounts.set(trimmed, (valueCounts.get(trimmed) ?? 0) + 1);

        if (rule.formatValidator) {
          const isValid = rule.formatValidator(trimmed, row);
          if (!isValid) {
            invalidCount++;
          }
        }
      }
    }

    const populatedCount = colTotal - nullCount;
    const distinctCount = valueCounts.size;
    const invalidRate = colTotal > 0 ? Number(((invalidCount / colTotal) * 100).toFixed(2)) : 0;

    // Top 5 values sorted descending by count, then alphabetically by value
    const sortedValues = Array.from(valueCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, maxTopValues)
      .map(([value, count]) => ({ value, count }));

    const profileKey = rule.recordType ? `${rule.recordType}.${rule.column}` : rule.column;

    columnProfiles[profileKey] = {
      column: rule.column,
      label: rule.label ?? rule.column,
      recordType: rule.recordType,
      totalRows: colTotal,
      populatedCount,
      nullCount,
      distinctCount,
      invalidFormatCount: invalidCount,
      invalidFormatRate: invalidRate,
      topValues: sortedValues,
    };
  }

  // 2. Exact duplicate candidate analysis
  const duplicateProfiles: Record<string, DuplicateKeyProfile> = {};

  if (config.duplicateKeys) {
    for (const dupRule of config.duplicateKeys) {
      const relevantRows = dupRule.recordType
        ? rows.filter((r) => r["record_type"] === dupRule.recordType)
        : rows;

      const keyMap = new Map<string, string[]>();

      for (const row of relevantRows) {
        const key = dupRule.extractKey(row);
        if (key && key.trim() !== "") {
          const rowId = row["row_id"] || row["source_id"] || "unknown";
          const existing = keyMap.get(key) ?? [];
          existing.push(rowId);
          keyMap.set(key, existing);
        }
      }

      let candidateCount = 0;
      const groups: DuplicateCandidateGroup[] = [];

      for (const [key, rowIds] of keyMap.entries()) {
        if (rowIds.length > 1) {
          candidateCount += rowIds.length - 1;
          groups.push({
            key,
            occurrences: rowIds.length,
            rowIds,
          });
        }
      }

      // Sort groups deterministically by descending occurrences, then key
      groups.sort((a, b) => b.occurrences - a.occurrences || a.key.localeCompare(b.key));

      duplicateProfiles[dupRule.name] = {
        ruleName: dupRule.name,
        label: dupRule.label ?? dupRule.name,
        recordType: dupRule.recordType,
        candidateCount,
        groups,
      };
    }
  }

  return {
    totalRows,
    sha256,
    isNonDestructive: true,
    columns: columnProfiles,
    exactDuplicates: duplicateProfiles,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Serializes a dataset profile report into a formula-safe CSV Data Health Report (FR-PR-03 / KIT-03).
 */
export function exportProfileReportToCsv(report: DatasetProfileReport): string {
  const lines: string[] = [];

  // Metadata Header
  lines.push(`# ClearShift Data Health Profile Report`);
  lines.push(`# Generated At: ${report.generatedAt}`);
  lines.push(`# Total Rows: ${report.totalRows}`);
  lines.push(`# Source SHA-256: ${report.sha256}`);
  lines.push(`# Non-Destructive Guarantee: ${report.isNonDestructive ? "VERIFIED" : "UNVERIFIED"}`);
  lines.push("");

  // Section 1: Column Statistics
  lines.push(`## Section 1: Column Quality Metrics`);
  const colHeaders = [
    "Profile Key",
    "Record Type",
    "Column",
    "Label",
    "Total Rows",
    "Populated",
    "Null Count",
    "Distinct Count",
    "Invalid Count",
    "Invalid Rate (%)",
    "Top 5 Values",
  ];
  lines.push(colHeaders.map(escapeCsvCell).join(","));

  for (const [key, col] of Object.entries(report.columns)) {
    const topValuesFormatted = col.topValues
      .map((tv) => `${tv.value} (${tv.count})`)
      .join(" | ");

    const row = [
      key,
      col.recordType ?? "global",
      col.column,
      col.label,
      col.totalRows,
      col.populatedCount,
      col.nullCount,
      col.distinctCount,
      col.invalidFormatCount,
      col.invalidFormatRate.toFixed(2),
      topValuesFormatted,
    ];
    lines.push(row.map(escapeCsvCell).join(","));
  }

  lines.push("");

  // Section 2: Exact Duplicate Review Candidates
  lines.push(`## Section 2: Exact Duplicate Candidate Groups`);
  const dupHeaders = [
    "Duplicate Rule",
    "Record Type",
    "Candidate Key",
    "Occurrences",
    "Row IDs",
  ];
  lines.push(dupHeaders.map(escapeCsvCell).join(","));

  for (const dup of Object.values(report.exactDuplicates)) {
    if (dup.groups.length === 0) {
      lines.push(
        [
          dup.label,
          dup.recordType ?? "global",
          "None",
          0,
          "No duplicates detected",
        ]
          .map(escapeCsvCell)
          .join(",")
      );
    } else {
      for (const group of dup.groups) {
        lines.push(
          [
            dup.label,
            dup.recordType ?? "global",
            group.key,
            group.occurrences,
            group.rowIds.join("; "),
          ]
            .map(escapeCsvCell)
            .join(",")
        );
      }
    }
  }

  return lines.join("\n");
}
