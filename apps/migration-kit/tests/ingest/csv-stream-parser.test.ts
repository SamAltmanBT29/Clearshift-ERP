import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { parseCsvStream } from '../../src/ingest/csv-stream-parser.js';
import {
  IngestionLimitError,
  InvalidEncodingError,
  MalformedFileError,
} from '@clearshift/contracts';

function createStreamFromBuffer(buffer: Buffer, chunkSize: number = 64): Readable {
  return new Readable({
    read() {
      if (buffer.length === 0) {
        this.push(null);
        return;
      }
      const slice = buffer.subarray(0, chunkSize);
      buffer = buffer.subarray(chunkSize);
      this.push(slice);
    },
  });
}

function createStreamFromString(text: string, chunkSize: number = 64): Readable {
  return createStreamFromBuffer(Buffer.from(text, 'utf8'), chunkSize);
}

describe('CSV Stream Parser & Boundary Limits (KIT-02)', () => {
  // ---------------------------------------------------------------------------
  // 1. Basic Parsing, Delimiters & Quotes (RFC-4180)
  // ---------------------------------------------------------------------------
  describe('Standard RFC-4180 Parsing & Delimiters', () => {
    it('parses comma-delimited CSV with standard headers and data rows', async () => {
      const csv = 'first_name,last_name,email\nAlice,Smith,alice@example.com\nBob,Jones,bob@example.com\n';
      const result = await parseCsvStream(createStreamFromString(csv));

      expect(result.headers).toEqual(['first_name', 'last_name', 'email']);
      expect(result.totalDataRows).toBe(2);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].sourceRow).toBe(1);
      expect(result.rows[0].payload).toEqual({
        first_name: 'Alice',
        last_name: 'Smith',
        email: 'alice@example.com',
      });
      expect(result.rows[1].sourceRow).toBe(2);
      expect(result.rows[1].rowHash).toHaveLength(64);
    });

    it('parses semicolon-delimited CSV when selected by user', async () => {
      const csv = 'product_id;name;price\nPRD-01;Widget;49.99\nPRD-02;Gadget;19.50\n';
      const result = await parseCsvStream(createStreamFromString(csv), { delimiter: ';' });

      expect(result.headers).toEqual(['product_id', 'name', 'price']);
      expect(result.totalDataRows).toBe(2);
      expect(result.rows[0].payload).toEqual({
        product_id: 'PRD-01',
        name: 'Widget',
        price: '49.99',
      });
    });

    it('preserves line breaks and commas inside quoted cells (RFC-4180)', async () => {
      const csv = 'id,address,note\n1,"123 Elm St\nApt 4B","Special, urgent note"\n2,"Simple St","None"\n';
      const result = await parseCsvStream(createStreamFromString(csv));

      expect(result.totalDataRows).toBe(2);
      expect(result.rows[0].payload.address).toBe('123 Elm St\nApt 4B');
      expect(result.rows[0].payload.note).toBe('Special, urgent note');
      expect(result.rows[1].payload.address).toBe('Simple St');
    });

    it('handles escaped quotes ("") correctly', async () => {
      const csv = 'id,comment\n1,"He said ""Hello world"" to everyone"\n';
      const result = await parseCsvStream(createStreamFromString(csv));

      expect(result.totalDataRows).toBe(1);
      expect(result.rows[0].payload.comment).toBe('He said "Hello world" to everyone');
    });

    it('throws MalformedFileError when quotes are unclosed at end of file', async () => {
      const csv = 'id,name\n1,"Unclosed quote string';
      await expect(parseCsvStream(createStreamFromString(csv))).rejects.toThrow(
        MalformedFileError
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 2. UTF-8 BOM & Encoding Validation
  // ---------------------------------------------------------------------------
  describe('UTF-8 BOM & Strict Encoding Validation', () => {
    it('strips UTF-8 BOM only at the start of the first header', async () => {
      const bomBuffer = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('email,name\nalice@example.com,Alice\n', 'utf8'),
      ]);

      const result = await parseCsvStream(createStreamFromBuffer(bomBuffer));
      expect(result.diagnostics.hasBom).toBe(true);
      expect(result.headers[0]).toBe('email');
      expect(result.headers[1]).toBe('name');
    });

    it('rejects invalid non-UTF-8 byte sequences with InvalidEncodingError', async () => {
      const invalidBuffer = Buffer.concat([
        Buffer.from('name,role\n', 'utf8'),
        Buffer.from([0xff, 0xfe, 0x99]), // Invalid UTF-8 sequence
        Buffer.from(',admin\n', 'utf8'),
      ]);

      await expect(parseCsvStream(createStreamFromBuffer(invalidBuffer))).rejects.toThrow(
        InvalidEncodingError
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Blank Physical Rows Handling
  // ---------------------------------------------------------------------------
  describe('Blank Physical Rows & Diagnostics', () => {
    it('ignores fully blank physical rows and records them in diagnostics', async () => {
      const csv = [
        'id,name',
        '', // blank
        '1,Alice',
        '   ', // whitespace only
        '2,Bob',
        '', // blank
        '', // blank
      ].join('\n') + '\n';

      const result = await parseCsvStream(createStreamFromString(csv));
      expect(result.totalDataRows).toBe(2);
      expect(result.diagnostics.blankRowsCount).toBe(4);
      expect(result.diagnostics.dataRowsCount).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Boundary Limits (100 Columns, 64 KiB Cell, 100k Rows, 50 MiB)
  // ---------------------------------------------------------------------------
  describe('Boundary Limits Enforcement', () => {
    it('accepts exactly 100 columns and rejects 101 columns (just over)', async () => {
      // Exactly 100 columns
      const headers100 = Array.from({ length: 100 }, (_, i) => `col_${i + 1}`).join(',');
      const row100 = Array.from({ length: 100 }, (_, i) => `val_${i + 1}`).join(',');
      const csv100 = `${headers100}\n${row100}\n`;

      const result100 = await parseCsvStream(createStreamFromString(csv100));
      expect(result100.headers).toHaveLength(100);
      expect(result100.totalDataRows).toBe(1);

      // Just over: 101 columns
      const headers101 = Array.from({ length: 101 }, (_, i) => `col_${i + 1}`).join(',');
      const csv101 = `${headers101}\n`;
      await expect(parseCsvStream(createStreamFromString(csv101))).rejects.toThrow(
        IngestionLimitError
      );
    });

    it('accepts exactly 64 KiB cell and rejects 64 KiB + 1 byte (just over)', async () => {
      const maxCellSize = 64 * 1024; // 65,536 bytes
      const exactCell = 'A'.repeat(maxCellSize);
      const csvExact = `id,payload\n1,"${exactCell}"\n`;

      const result = await parseCsvStream(createStreamFromString(csvExact));
      expect(result.totalDataRows).toBe(1);
      expect(result.rows[0].payload.payload).toHaveLength(maxCellSize);

      // 64 KiB + 1 byte
      const overCell = 'A'.repeat(maxCellSize + 1);
      const csvOver = `id,payload\n1,"${overCell}"\n`;

      await expect(parseCsvStream(createStreamFromString(csvOver))).rejects.toThrow(
        IngestionLimitError
      );
    });

    it('rejects row count exceeding maxDataRows limit', async () => {
      const csv = 'id,name\n1,A\n2,B\n3,C\n4,D\n5,E\n';
      // Test with custom maxDataRows = 4
      await expect(
        parseCsvStream(createStreamFromString(csv), { maxDataRows: 4 })
      ).rejects.toThrow(IngestionLimitError);
    });

    it('rejects file exceeding maxSizeBytes limit', async () => {
      const chunk = 'a,b,c\n1,2,3\n';
      // Test with small maxSizeBytes limit
      await expect(
        parseCsvStream(createStreamFromString(chunk), { maxSizeBytes: 5 })
      ).rejects.toThrow(IngestionLimitError);
    });
  });
});
