import { describe, it, expect } from 'vitest';
import {
  neutralizeFormula,
  formatCsvCell,
  exportProfileReportCsv,
} from '../../src/profile/csv-export.js';
import { ProfileReport } from '@clearshift/contracts';

describe('Profile CSV Exporter & Formula Neutralization (KIT-03)', () => {
  describe('Formula Neutralization', () => {
    it('prepends single quote to trigger characters (=, +, -, @, \\t, \\r)', () => {
      expect(neutralizeFormula('=SUM(A1:B10)')).toBe("'=SUM(A1:B10)");
      expect(neutralizeFormula('+12345')).toBe("'+12345");
      expect(neutralizeFormula('-500')).toBe("'-500");
      expect(neutralizeFormula('@admin')).toBe("'@admin");
      expect(neutralizeFormula('\tmalicious')).toBe("'\tmalicious");
      expect(neutralizeFormula('\rmalicious')).toBe("'\rmalicious");
    });

    it('leaves standard strings untouched', () => {
      expect(neutralizeFormula('Alice')).toBe('Alice');
      expect(neutralizeFormula('user@example.com')).toBe('user@example.com');
      expect(neutralizeFormula('100')).toBe('100');
    });
  });

  describe('RFC-4180 Escaping', () => {
    it('escapes cells containing commas, quotes, and newlines', () => {
      expect(formatCsvCell('Hello, World')).toBe('"Hello, World"');
      expect(formatCsvCell('He said "hello"')).toBe('"He said ""hello"""');
      expect(formatCsvCell('Line1\nLine2')).toBe('"Line1\nLine2"');
    });
  });

  describe('exportProfileReportCsv', () => {
    it('generates deterministic formula-safe CSV report with headers and column profiles', () => {
      const mockReport: ProfileReport = {
        batchId: '11111111-1111-4111-8111-111111111111',
        module: 'crm',
        rulesetVersion: 1,
        totalRows: 100,
        totalColumns: 2,
        columns: [
          {
            columnName: 'salary',
            totalRows: 100,
            emptyCount: 5,
            distinctCount: 80,
            invalidCount: 2,
            inferredType: 'decimal',
            topValues: [{ value: '50000', count: 10, percentage: 10 }],
            minValue: '20000',
            maxValue: '150000',
          },
          {
            columnName: '=cmd_column',
            totalRows: 100,
            emptyCount: 0,
            distinctCount: 10,
            invalidCount: 0,
            inferredType: 'string',
            topValues: [{ value: '+evil', count: 5, percentage: 5 }],
            minValue: 'A',
            maxValue: 'Z',
          },
        ],
        duplicates: {
          keyFields: ['email'],
          totalDuplicates: 4,
          uniqueDuplicateKeys: 2,
          sampleDuplicateKeys: ['dup@test.com'],
        },
        summary: {
          emptyCount: 5,
          invalidCount: 2,
          duplicateCount: 4,
        },
        generatedAt: new Date('2026-10-23T00:00:00.000Z'),
      };

      const csv = exportProfileReportCsv(mockReport);
      expect(csv).toContain('# Batch ID,11111111-1111-4111-8111-111111111111');
      // Neutralized column name and top values
      expect(csv).toContain("'=cmd_column");
      expect(csv).toContain("'+evil (5)");
      // Deterministically sorted: =cmd_column before salary
      const cmdIdx = csv.indexOf("'=cmd_column");
      const salaryIdx = csv.indexOf('salary');
      expect(cmdIdx).toBeLessThan(salaryIdx);
    });
  });
});
