import { ProfileReport } from '@clearshift/contracts';

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Neutralizes potential CSV/spreadsheet formula injection vulnerabilities
 */
export function neutralizeFormula(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.length === 0) return '';

  const firstChar = str.charAt(0);
  if (firstChar !== '' && FORMULA_TRIGGERS.includes(firstChar)) {
    return `'${str}`;
  }
  return str;
}

/**
 * Formats a single CSV cell with RFC-4180 escaping and formula neutralization
 */
export function formatCsvCell(value: string | number | null | undefined): string {
  const safeVal = neutralizeFormula(value);
  if (safeVal.includes(',') || safeVal.includes('"') || safeVal.includes('\n') || safeVal.includes('\r')) {
    return `"${safeVal.replace(/"/g, '""')}"`;
  }
  return safeVal;
}

/**
 * Exports a ProfileReport to deterministic, formula-safe CSV data health report
 */
export function exportProfileReportCsv(report: ProfileReport): string {
  const lines: string[] = [];

  // 1. Header Metadata Section
  lines.push(['# Report Type', 'Data Health Profile Report'].map(formatCsvCell).join(','));
  lines.push(['# Batch ID', report.batchId].map(formatCsvCell).join(','));
  lines.push(['# Module', report.module].map(formatCsvCell).join(','));
  lines.push(['# Ruleset Version', String(report.rulesetVersion)].map(formatCsvCell).join(','));
  lines.push(['# Generated At', new Date(report.generatedAt).toISOString()].map(formatCsvCell).join(','));
  lines.push(['# Total Rows', String(report.totalRows)].map(formatCsvCell).join(','));
  lines.push(['# Total Columns', String(report.totalColumns)].map(formatCsvCell).join(','));
  lines.push(['# Empty Values Total', String(report.summary.emptyCount)].map(formatCsvCell).join(','));
  lines.push(['# Format Errors Total', String(report.summary.invalidCount)].map(formatCsvCell).join(','));
  lines.push(['# Duplicate Candidates Total', String(report.summary.duplicateCount)].map(formatCsvCell).join(','));
  lines.push('');

  // 2. Column Statistics Section
  const colHeaders = [
    'column_name',
    'inferred_type',
    'total_rows',
    'empty_count',
    'invalid_count',
    'distinct_count',
    'min_value',
    'max_value',
    'top_value_1',
    'top_value_2',
    'top_value_3',
    'top_value_4',
    'top_value_5',
  ];
  lines.push(colHeaders.map(formatCsvCell).join(','));

  // Sort columns deterministically by column_name
  const sortedColumns = [...report.columns].sort((a, b) => a.columnName.localeCompare(b.columnName));

  for (const col of sortedColumns) {
    const topValuesFormatted = col.topValues.map((tv) => `${tv.value} (${tv.count})`);
    while (topValuesFormatted.length < 5) {
      topValuesFormatted.push('');
    }

    const row = [
      col.columnName,
      col.inferredType,
      col.totalRows,
      col.emptyCount,
      col.invalidCount,
      col.distinctCount,
      col.minValue ?? '',
      col.maxValue ?? '',
      topValuesFormatted[0],
      topValuesFormatted[1],
      topValuesFormatted[2],
      topValuesFormatted[3],
      topValuesFormatted[4],
    ];
    lines.push(row.map(formatCsvCell).join(','));
  }

  lines.push('');

  // 3. Duplicate Candidates Section
  lines.push(['# Duplicate Analysis'].map(formatCsvCell).join(','));
  lines.push(['Key Fields', report.duplicates.keyFields.join(' + ')].map(formatCsvCell).join(','));
  lines.push(['Total Duplicate Rows', String(report.duplicates.totalDuplicates)].map(formatCsvCell).join(','));
  lines.push(['Unique Duplicate Keys', String(report.duplicates.uniqueDuplicateKeys)].map(formatCsvCell).join(','));
  if (report.duplicates.sampleDuplicateKeys.length > 0) {
    lines.push(['Sample Duplicate Keys', report.duplicates.sampleDuplicateKeys.join('; ')].map(formatCsvCell).join(','));
  }

  return lines.join('\n') + '\n';
}
