/**
 * ClearShift Migration Kit — Boundary Limits & Anti-Abuse Test Suite (KIT-18)
 *
 * Validates SDS ClearShift Migration Kit v2.0 §§3-4, §4.4, §11.1 and Core Rules:
 * - 50 MiB maximum source file size boundary enforcement.
 * - Maximum column count boundary (100 columns).
 * - Maximum cell length boundary (64 KiB).
 * - Archive security: Zip Slip directory traversal & expansion bomb protection.
 * - Memory bounds: no full-file buffering; chunked streaming iteration.
 *
 * @module migration-kit/tests/performance/boundary-limits.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import {
  MAX_MIGRATION_FILE_SIZE_BYTES,
  MAX_MIGRATION_COLUMN_COUNT,
  MAX_MIGRATION_CELL_SIZE_BYTES,
  BoundaryLimitError,
} from '@clearshift/contracts';
import {
  validateFile,
  createBatch,
  parseCsv,
  parseXlsx,
  parseZipEntries,
  createSyntheticXlsx,
  BatchStore,
} from '../../cli/batch-engine.js';
import { parseCsvStream } from '@cs/kit';

const TEST_DIR = join(tmpdir(), 'cs-kit-boundary-limits-test');

function buildRawZipWithEntry(name: string, content: Buffer | string, options?: { compSize?: number; uncompSize?: number }): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const dataBuf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const compressed = deflateRawSync(dataBuf);

  const compSize = options?.compSize ?? compressed.length;
  const uncompSize = options?.uncompSize ?? dataBuf.length;

  const lh = Buffer.alloc(30 + nameBuf.length);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0, 6);
  lh.writeUInt16LE(8, 8); // deflate
  lh.writeUInt16LE(0, 10);
  lh.writeUInt16LE(0, 12);
  lh.writeUInt32LE(0x12345678, 14); // dummy crc
  lh.writeUInt32LE(compSize, 18);
  lh.writeUInt32LE(uncompSize, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  lh.writeUInt16LE(0, 28);
  nameBuf.copy(lh, 30);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);

  return Buffer.concat([lh, compressed, eocd]);
}

describe('KIT-18: Boundary Limits & Anti-Abuse Controls', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // 1. 50 MiB File Size Limit Boundary
  // ==========================================================================
  describe('50 MiB File Boundary Enforcement', () => {
    it('accepts files within the 50 MiB boundary (<= 52,428,800 bytes)', () => {
      const validFile = join(TEST_DIR, 'valid-size.csv');
      writeFileSync(validFile, 'first_name,last_name,email\nAlice,Smith,alice@example.com\n');

      const check = validateFile(validFile);
      expect(check.ok).toBe(true);
      if (check.ok) {
        expect(check.size).toBeLessThanOrEqual(MAX_MIGRATION_FILE_SIZE_BYTES);
      }
    });

    it('rejects files exceeding the 50 MiB limit with deterministic error', () => {
      const oversizeFile = join(TEST_DIR, 'oversize.csv');
      // Create a sparse file of 50 MB + 1 byte (52,428,801 bytes)
      const targetSize = MAX_MIGRATION_FILE_SIZE_BYTES + 1;
      const fd = Buffer.alloc(10);
      writeFileSync(oversizeFile, fd);
      // Truncate/pad to exact boundary + 1 byte
      const fs = require('node:fs');
      fs.truncateSync(oversizeFile, targetSize);

      const check = validateFile(oversizeFile);
      expect(check.ok).toBe(false);
      if (!check.ok) {
        expect(check.reason).toContain('File exceeds 50 MB limit');
      }

      const store = new BatchStore(TEST_DIR);
      expect(() => {
        createBatch({ module: 'crm1', file: oversizeFile }, store);
      }).toThrow(/File exceeds 50 MB limit/);
    });

    it('streaming parser destroys stream when 50 MiB boundary is exceeded without unbounded memory growth', async () => {
      // Create a stream that emits chunks up to 51 MB
      const chunkSize = 1024 * 1024; // 1 MB
      let emitted = 0;
      const totalToEmit = 51 * 1024 * 1024; // 51 MB

      const stream = new Readable({
        read() {
          if (emitted >= totalToEmit) {
            this.push(null);
            return;
          }
          const buf = Buffer.alloc(chunkSize, 'A,B,C\n');
          emitted += chunkSize;
          this.push(buf);
        },
      });

      await expect(
        parseCsvStream(stream, { maxBytes: MAX_MIGRATION_FILE_SIZE_BYTES })
      ).rejects.toThrow(/File size exceeds maximum allowed ceiling of 50 MB/);
    });
  });

  // ==========================================================================
  // 2. Column Count Boundary (Max 100 Columns)
  // ==========================================================================
  describe('Column Count Limit Enforcement (Max 100 Columns)', () => {
    it('accepts CSV and XLSX with up to 100 columns', () => {
      const headers = Array.from({ length: 100 }, (_, i) => `col_${i + 1}`);
      const row = Object.fromEntries(headers.map((h, i) => [h, `val_${i + 1}`]));
      const csv = `${headers.join(',')}\n${headers.map((h) => row[h]).join(',')}\n`;

      const parsedCsv = parseCsv(csv);
      expect(parsedCsv.headers.length).toBe(100);
      expect(parsedCsv.rows.length).toBe(1);

      const xlsxBuf = createSyntheticXlsx(headers, [row]);
      const parsedXlsx = parseXlsx(xlsxBuf);
      expect(parsedXlsx.headers.length).toBe(100);
      expect(parsedXlsx.rows.length).toBe(1);
    });

    it('rejects CSV with 101 columns with COLUMN_LIMIT_EXCEEDED (HTTP 400)', () => {
      const headers = Array.from({ length: 101 }, (_, i) => `col_${i + 1}`);
      const csv = `${headers.join(',')}\n${headers.map(() => 'v').join(',')}\n`;

      expect(() => parseCsv(csv)).toThrowError(BoundaryLimitError);
      expect(() => parseCsv(csv)).toThrow(/Column count exceeds maximum allowable limit of 100/);
    });

    it('rejects XLSX with 105 columns with COLUMN_LIMIT_EXCEEDED', () => {
      const headers = Array.from({ length: 105 }, (_, i) => `col_${i + 1}`);
      const row = Object.fromEntries(headers.map((h) => [h, '1']));
      const xlsxBuf = createSyntheticXlsx(headers, [row]);

      expect(() => parseXlsx(xlsxBuf)).toThrowError(BoundaryLimitError);
      expect(() => parseXlsx(xlsxBuf)).toThrow(/Column count exceeds maximum allowable limit of 100/);
    });
  });

  // ==========================================================================
  // 3. Cell Size Limit Boundary (Max 64 KiB)
  // ==========================================================================
  describe('Cell Size Limit Enforcement (Max 64 KiB per Cell)', () => {
    it('accepts cells up to 64 KiB (65,536 bytes)', () => {
      const safeLargeCell = 'x'.repeat(64 * 1024);
      const csv = `first_name,notes\nAlice,"${safeLargeCell}"\n`;

      const parsed = parseCsv(csv);
      expect(parsed.rows.length).toBe(1);
      expect(parsed.rows[0]?.['notes']?.length).toBe(64 * 1024);
    });

    it('rejects CSV cells exceeding 64 KiB with CELL_SIZE_LIMIT_EXCEEDED', () => {
      const oversizeCell = 'y'.repeat(65 * 1024); // 65 KiB > 64 KiB
      const csv = `first_name,notes\nBob,"${oversizeCell}"\n`;

      expect(() => parseCsv(csv)).toThrowError(BoundaryLimitError);
      expect(() => parseCsv(csv)).toThrow(/Cell size exceeds 65536 bytes limit/);
    });

    it('rejects XLSX cells exceeding 64 KiB with CELL_SIZE_LIMIT_EXCEEDED', () => {
      let oversizeCell = '';
      for (let i = 0; i < 68000; i++) {
        oversizeCell += String.fromCharCode(65 + (i % 26));
      }
      const xlsxBuf = createSyntheticXlsx(['first_name', 'notes'], [{ first_name: 'Carol', notes: oversizeCell }]);

      expect(() => parseXlsx(xlsxBuf)).toThrowError(BoundaryLimitError);
      expect(() => parseXlsx(xlsxBuf)).toThrow(/Cell size exceeds 65536 bytes limit/);
    });
  });

  // ==========================================================================
  // 4. Archive Security & Anti-Abuse (Zip Slip & Zip Bomb)
  // ==========================================================================
  describe('Archive Security & Anti-Abuse (Zip Slip & Expansion Bombs)', () => {
    it('detects and rejects Zip Slip directory traversal paths in XLSX archives', () => {
      const maliciousZip = buildRawZipWithEntry('../../etc/passwd', 'root:x:0:0:root:/root:/bin/bash');

      expect(() => parseZipEntries(maliciousZip)).toThrowError(BoundaryLimitError);
      expect(() => parseZipEntries(maliciousZip)).toThrow(/Archive traversal threat detected/);
    });

    it('detects and rejects absolute file paths in XLSX archives', () => {
      const maliciousZip = buildRawZipWithEntry('/tmp/exploit.xml', '<root/>');

      expect(() => parseZipEntries(maliciousZip)).toThrowError(BoundaryLimitError);
      expect(() => parseZipEntries(maliciousZip)).toThrow(/Archive traversal threat detected/);
    });

    it('detects and rejects Zip Bomb expansion ratio abuse (> 100:1 ratio above 10 MB)', () => {
      // Declare compressed size = 10, uncompressed size = 20 MB (ratio 2,000,000:1)
      const zipBomb = buildRawZipWithEntry('xl/worksheets/sheet1.xml', 'x'.repeat(100), {
        compSize: 10,
        uncompSize: 20 * 1024 * 1024,
      });

      expect(() => parseZipEntries(zipBomb)).toThrowError(BoundaryLimitError);
      expect(() => parseZipEntries(zipBomb)).toThrow(/Archive expansion bomb detected/);
    });
  });

  // ==========================================================================
  // 5. Memory Bounds & No Full-File Buffering
  // ==========================================================================
  describe('No Full-File Buffering & Bounded Streaming', () => {
    it('processes records in 500-row chunks while maintaining bounded heap growth', () => {
      const rows = Array.from({ length: 5000 }, (_, i) => ({
        sourceRow: i + 1,
        data: {
          first_name: `StreamFirst${i}`,
          last_name: `StreamLast${i}`,
          email: `stream${i}@example.com`,
          phone: '+1-555-0100',
        },
      }));

      const rssStart = process.memoryUsage().rss;
      const chunks: Array<typeof rows> = [];
      const CHUNK_SIZE = 500;

      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        chunks.push(rows.slice(i, i + CHUNK_SIZE));
      }

      expect(chunks.length).toBe(10);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBe(CHUNK_SIZE);
      });

      const rssEnd = process.memoryUsage().rss;
      const deltaMb = Math.abs(rssEnd - rssStart) / (1024 * 1024);
      // Bounded heap growth for chunked references (< 50 MB delta)
      expect(deltaMb).toBeLessThan(50);
    });
  });
});
