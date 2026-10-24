import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import { parseXlsxStream } from '../../src/ingest/xlsx-stream-parser.js';
import {
  IngestionLimitError,
  SecurityRejectedError,
  MalformedFileError,
} from '@clearshift/contracts';

interface ZipFileEntry {
  name: string;
  content: string | Buffer;
  encrypted?: boolean;
}

/**
 * Creates a valid in-memory ZIP archive with standard local file headers
 */
function buildMockZip(entries: ZipFileEntry[]): Buffer {
  const parts: Buffer[] = [];

  for (const entry of entries) {
    const rawData = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, 'utf8');

    const compressed = deflateRawSync(rawData);
    const filenameBuf = Buffer.from(entry.name, 'utf8');

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(entry.encrypted ? 0x0001 : 0x0000, 6); // flags (bit 0 = encrypted)
    header.writeUInt16LE(8, 8); // compression method (8 = deflate)
    header.writeUInt16LE(0, 10); // mod time
    header.writeUInt16LE(0, 12); // mod date
    header.writeUInt32LE(0, 14); // crc32
    header.writeUInt32LE(compressed.length, 18); // compressed size
    header.writeUInt32LE(rawData.length, 22); // uncompressed size
    header.writeUInt16LE(filenameBuf.length, 26); // filename length
    header.writeUInt16LE(0, 28); // extra field length

    parts.push(header, filenameBuf, compressed);
  }

  return Buffer.concat(parts);
}

function streamFromBuffer(buf: Buffer): Readable {
  return Readable.from(buf);
}

describe('XLSX Stream Parser & Security Guards (KIT-02)', () => {
  // ---------------------------------------------------------------------------
  // 1. Valid First Worksheet & Shared Strings
  // ---------------------------------------------------------------------------
  describe('Valid First Worksheet & Shared Strings', () => {
    it('parses valid XLSX extracting headers and data rows from first sheet', async () => {
      const sheetXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="s"><v>2</v></c>
    </row>
    <row r="2">
      <c r="A2"><v>1001</v></c>
      <c r="B2" t="inlineStr"><is><t>Acme Corp</t></is></c>
      <c r="C2"><v>45000</v></c>
    </row>
    <row r="3">
      <c r="A3"><v>1002</v></c>
      <c r="B3" t="inlineStr"><is><t>Beta LLC</t></is></c>
      <c r="C3"><v>75000</v></c>
    </row>
  </sheetData>
</worksheet>`;

      const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>account_id</t></si>
  <si><t>company_name</t></si>
  <si><t>annual_revenue</t></si>
</sst>`;

      const zipBuf = buildMockZip([
        { name: 'xl/sharedStrings.xml', content: sharedStringsXml },
        { name: 'xl/worksheets/sheet1.xml', content: sheetXml },
      ]);

      const result = await parseXlsxStream(streamFromBuffer(zipBuf));
      expect(result.headers).toEqual(['account_id', 'company_name', 'annual_revenue']);
      expect(result.totalDataRows).toBe(2);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].payload).toEqual({
        account_id: '1001',
        company_name: 'Acme Corp',
        annual_revenue: '45000',
      });
      expect(result.rows[1].payload.company_name).toBe('Beta LLC');
      expect(result.fileHash).toHaveLength(64);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Security Rejections: Macros, Encryption & Zip Bombs
  // ---------------------------------------------------------------------------
  describe('Security Policy Enforcement', () => {
    it('rejects macro-enabled archives containing vbaProject.bin with SecurityRejectedError', async () => {
      const zipBuf = buildMockZip([
        { name: 'xl/worksheets/sheet1.xml', content: '<worksheet><sheetData/></worksheet>' },
        { name: 'xl/vbaProject.bin', content: 'MALICIOUS_VBA_PAYLOAD' },
      ]);

      await expect(parseXlsxStream(streamFromBuffer(zipBuf))).rejects.toThrow(
        SecurityRejectedError
      );
    });

    it('rejects password-protected / encrypted archives with SecurityRejectedError', async () => {
      const zipBuf = buildMockZip([
        {
          name: 'xl/worksheets/sheet1.xml',
          content: '<worksheet><sheetData/></worksheet>',
          encrypted: true,
        },
      ]);

      await expect(parseXlsxStream(streamFromBuffer(zipBuf))).rejects.toThrow(
        SecurityRejectedError
      );
    });

    it('rejects decompression bomb with excessive compression ratio', async () => {
      // Create repetitive buffer with extreme compression ratio
      const payload = Buffer.alloc(50000, 0x41); // 50KB of 'A'
      const compressed = deflateRawSync(payload);
      const filenameBuf = Buffer.from('xl/worksheets/sheet1.xml', 'utf8');

      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0, 6);
      header.writeUInt16LE(8, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(0, 12);
      header.writeUInt32LE(0, 14);
      header.writeUInt32LE(compressed.length, 18);
      // Forge excessive uncompressed size (25 MiB with ~200B compressed = ~125,000x ratio)
      header.writeUInt32LE(25 * 1024 * 1024, 22);
      header.writeUInt16LE(filenameBuf.length, 26);
      header.writeUInt16LE(0, 28);

      const bombZip = Buffer.concat([header, filenameBuf, compressed]);

      await expect(parseXlsxStream(streamFromBuffer(bombZip))).rejects.toThrow(
        SecurityRejectedError
      );
    });

    it('rejects corrupted or non-ZIP input with MalformedFileError', async () => {
      const garbage = Buffer.from('NOT_A_VALID_ZIP_ARCHIVE', 'utf8');
      await expect(parseXlsxStream(streamFromBuffer(garbage))).rejects.toThrow(
        MalformedFileError
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Boundary Limits (100 Columns, 64 KiB Cell)
  // ---------------------------------------------------------------------------
  describe('XLSX Boundary Limits', () => {
    function indexToColLetters(index: number): string {
      let letters = '';
      let temp = index;
      while (temp >= 0) {
        letters = String.fromCharCode((temp % 26) + 65) + letters;
        temp = Math.floor(temp / 26) - 1;
      }
      return letters;
    }

    it('accepts exactly 100 columns and rejects 101 columns (just over)', async () => {
      // Build 100 column sheet
      const cells100 = Array.from(
        { length: 100 },
        (_, i) => `<c r="${indexToColLetters(i)}1" t="inlineStr"><is><t>h_${i + 1}</t></is></c>`
      ).join('');
      const sheetXml100 = `<worksheet><sheetData><row r="1">${cells100}</row></sheetData></worksheet>`;
      const zip100 = buildMockZip([{ name: 'xl/worksheets/sheet1.xml', content: sheetXml100 }]);

      const result = await parseXlsxStream(streamFromBuffer(zip100));
      expect(result.headers).toHaveLength(100);

      // Build 101 column sheet
      const cells101 = Array.from(
        { length: 101 },
        (_, i) => `<c r="${indexToColLetters(i)}1" t="inlineStr"><is><t>h_${i + 1}</t></is></c>`
      ).join('');
      const sheetXml101 = `<worksheet><sheetData><row r="1">${cells101}</row></sheetData></worksheet>`;
      const zip101 = buildMockZip([{ name: 'xl/worksheets/sheet1.xml', content: sheetXml101 }]);

      await expect(parseXlsxStream(streamFromBuffer(zip101))).rejects.toThrow(
        IngestionLimitError
      );
    });

    it('rejects cell exceeding 64 KiB cell limit', async () => {
      const overCell = 'X'.repeat(64 * 1024 + 1);
      const sheetXml = `<worksheet><sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>header</t></is></c></row>
        <row r="2"><c r="A2" t="inlineStr"><is><t>${overCell}</t></is></c></row>
      </sheetData></worksheet>`;

      const zip = buildMockZip([{ name: 'xl/worksheets/sheet1.xml', content: sheetXml }]);
      await expect(parseXlsxStream(streamFromBuffer(zip))).rejects.toThrow(
        IngestionLimitError
      );
    });
  });
});
