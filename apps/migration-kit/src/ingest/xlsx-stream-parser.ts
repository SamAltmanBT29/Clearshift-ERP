import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import {
  INGESTION_LIMITS,
  IngestionLimitError,
  SecurityRejectedError,
  MalformedFileError,
  ParserDiagnostics,
  RawRow,
} from '@clearshift/contracts';

export interface XlsxParserOptions {
  batchId?: string;
  maxSizeBytes?: number;
  maxColumns?: number;
  maxDataRows?: number;
  maxCellSizeBytes?: number;
  maxExpandedSizeBytes?: number;
  onRow?: (row: RawRow) => Promise<void> | void;
}

export interface XlsxParseResult {
  headers: string[];
  totalDataRows: number;
  totalBytes: number;
  fileHash: string;
  diagnostics: ParserDiagnostics;
  rows: RawRow[];
}

interface ZipEntry {
  filename: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  data: Buffer;
}

/**
 * Parses ZIP container entries while enforcing:
 * - Total archive size <= 50 MiB
 * - Cumulative expanded size <= 250 MiB (ZIP-bomb defense)
 * - Compression ratio limits
 * - Rejection of encrypted files and macros
 */
async function parseZipArchive(
  inputStream: Readable,
  maxArchiveBytes: number,
  maxExpandedBytes: number,
  fileHasher: ReturnType<typeof createHash>
): Promise<{ entries: Map<string, Buffer>; totalArchiveBytes: number }> {
  const chunks: Buffer[] = [];
  let totalArchiveBytes = 0;

  for await (const chunk of inputStream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalArchiveBytes += buf.length;
    fileHasher.update(buf);

    if (totalArchiveBytes > maxArchiveBytes) {
      throw new IngestionLimitError('MAX_FILE_SIZE', maxArchiveBytes, totalArchiveBytes);
    }
    chunks.push(buf);
  }

  const archiveBuffer = Buffer.concat(chunks);
  const entries = new Map<string, Buffer>();
  let offset = 0;
  let cumulativeExpandedBytes = 0;

  // Verify PK signature
  if (archiveBuffer.length < 4 || archiveBuffer.readUInt32LE(0) !== 0x04034b50) {
    // Check if it's an encrypted OLE package
    if (archiveBuffer.length >= 8 && archiveBuffer.toString('latin1', 0, 8).includes('D0CF11E0')) {
      throw new SecurityRejectedError('Encrypted or password-protected Excel files are not supported');
    }
    throw new MalformedFileError('Not a valid ZIP/XLSX archive');
  }

  while (offset + 30 <= archiveBuffer.length) {
    const signature = archiveBuffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      // Reached central directory or end of local file headers
      break;
    }

    const flags = archiveBuffer.readUInt16LE(offset + 6);
    // Bit 0: Encrypted entry
    if ((flags & 0x01) !== 0) {
      throw new SecurityRejectedError('Archive entry is password-protected or encrypted');
    }

    const compressionMethod = archiveBuffer.readUInt16LE(offset + 8);
    const compressedSize = archiveBuffer.readUInt32LE(offset + 18);
    const uncompressedSize = archiveBuffer.readUInt32LE(offset + 22);
    const filenameLen = archiveBuffer.readUInt16LE(offset + 26);
    const extraLen = archiveBuffer.readUInt16LE(offset + 28);

    offset += 30;
    if (offset + filenameLen > archiveBuffer.length) {
      throw new MalformedFileError('Corrupted ZIP entry header: truncated filename');
    }

    const filename = archiveBuffer.toString('utf8', offset, offset + filenameLen);
    offset += filenameLen + extraLen;

    // Security check: Macros
    if (
      filename.toLowerCase().includes('vbaproject.bin') ||
      filename.toLowerCase().includes('vbadata.xml') ||
      filename.toLowerCase().endsWith('.xlsm') ||
      filename.toLowerCase().endsWith('.xltm')
    ) {
      throw new SecurityRejectedError('Archive contains macros or executable VBA project');
    }

    // Security check: Encryption records
    if (
      filename.toLowerCase().includes('encryptedpackage') ||
      filename.toLowerCase().includes('encryptioninfo')
    ) {
      throw new SecurityRejectedError('Encrypted or password-protected Excel files are not supported');
    }

    if (offset + compressedSize > archiveBuffer.length) {
      throw new MalformedFileError(`Corrupted ZIP entry: truncated payload for ${filename}`);
    }

    const compressedData = archiveBuffer.subarray(offset, offset + compressedSize);
    offset += compressedSize;

    // ZIP bomb defense: check compression ratio for non-trivial payloads and cumulative size
    if (compressedSize > 0 && uncompressedSize > 10 * 1024 * 1024 && uncompressedSize > compressedSize * 150) {
      throw new SecurityRejectedError('Suspected decompression bomb: excessive compression ratio');
    }

    cumulativeExpandedBytes += uncompressedSize;
    if (cumulativeExpandedBytes > maxExpandedBytes) {
      throw new IngestionLimitError('MAX_EXPANDED_ARCHIVE', maxExpandedBytes, cumulativeExpandedBytes);
    }

    let uncompressedData: Buffer;
    if (compressionMethod === 0) {
      uncompressedData = compressedData;
    } else if (compressionMethod === 8) {
      try {
        uncompressedData = inflateRawSync(compressedData);
      } catch (err: unknown) {
        throw new MalformedFileError(`Failed to decompress entry ${filename}: ${(err as Error).message}`);
      }
    } else {
      throw new MalformedFileError(`Unsupported ZIP compression method: ${compressionMethod}`);
    }

    if (uncompressedData.length !== uncompressedSize && uncompressedSize !== 0) {
      cumulativeExpandedBytes += (uncompressedData.length - uncompressedSize);
      if (cumulativeExpandedBytes > maxExpandedBytes) {
        throw new IngestionLimitError('MAX_EXPANDED_ARCHIVE', maxExpandedBytes, cumulativeExpandedBytes);
      }
    }

    entries.set(filename, uncompressedData);
  }

  return { entries, totalArchiveBytes };
}

/**
 * Extracts shared strings table from xl/sharedStrings.xml
 */
function extractSharedStrings(xmlBuffer?: Buffer): string[] {
  if (!xmlBuffer) return [];
  const xml = xmlBuffer.toString('utf8');
  const strings: string[] = [];

  // Match each <si>...</si> entry
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch: RegExpExecArray | null;

  while ((siMatch = siRegex.exec(xml)) !== null) {
    const siContent = siMatch[1] || '';
    // Concatenate all <t> or <t ...> tags inside the <si>
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch: RegExpExecArray | null;
    let fullText = '';
    while ((tMatch = tRegex.exec(siContent)) !== null) {
      if (tMatch[1]) {
        fullText += decodeXmlEntities(tMatch[1]);
      }
    }
    strings.push(fullText);
  }

  return strings;
}

/**
 * Decodes standard XML entities
 */
function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Convert Excel column letters (A, B, ..., Z, AA, AB) to 0-based column index
 */
function colLettersToIndex(letters: string): number {
  let index = 0;
  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Streaming / Bounded XLSX Parser for the first worksheet
 */
export async function parseXlsxStream(
  inputStream: Readable,
  options: XlsxParserOptions = {}
): Promise<XlsxParseResult> {
  const batchId = options.batchId || '00000000-0000-0000-0000-000000000000';
  const maxBytes = options.maxSizeBytes ?? INGESTION_LIMITS.MAX_FILE_SIZE_BYTES;
  const maxExpandedBytes = options.maxExpandedSizeBytes ?? INGESTION_LIMITS.MAX_EXPANDED_ARCHIVE_SIZE_BYTES;
  const maxColumns = options.maxColumns ?? INGESTION_LIMITS.MAX_COLUMNS;
  const maxDataRows = options.maxDataRows ?? INGESTION_LIMITS.MAX_DATA_ROWS;
  const maxCellBytes = options.maxCellSizeBytes ?? INGESTION_LIMITS.MAX_CELL_SIZE_BYTES;

  const fileHasher = createHash('sha256');

  // 1. Decompress ZIP archive safely with boundary checks
  const { entries, totalArchiveBytes } = await parseZipArchive(
    inputStream,
    maxBytes,
    maxExpandedBytes,
    fileHasher
  );

  const fileHash = fileHasher.digest('hex');

  // 2. Identify first sheet target
  // Standard location is xl/worksheets/sheet1.xml
  let sheet1Buffer = entries.get('xl/worksheets/sheet1.xml');
  if (!sheet1Buffer) {
    // Search for first worksheet matching xl/worksheets/*.xml
    for (const [name, buf] of entries.entries()) {
      if (name.startsWith('xl/worksheets/') && name.endsWith('.xml')) {
        sheet1Buffer = buf;
        break;
      }
    }
  }

  if (!sheet1Buffer) {
    throw new MalformedFileError('Workbook does not contain any readable worksheets');
  }

  // 3. Extract shared strings if present
  const sharedStrings = extractSharedStrings(entries.get('xl/sharedStrings.xml'));

  // 4. Parse first worksheet XML
  const sheetXml = sheet1Buffer.toString('utf8');

  let headers: string[] | null = null;
  let dataRowCount = 0;
  let blankRowsCount = 0;
  let physicalLinesCount = 0;
  let headerRowIndex = 0;
  const rows: RawRow[] = [];

  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    physicalLinesCount++;
    const rowContent = rowMatch[1] || '';

    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;

    const rowCellsByIndex: Map<number, string> = new Map();
    let maxColIdx = -1;

    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const cellAttrs = cellMatch[1] || '';
      const cellBody = cellMatch[2] || '';

      const rMatch = /\br="([A-Z]+)[0-9]+"/.exec(cellAttrs);
      const colLetters = (rMatch && rMatch[1]) ? rMatch[1] : 'A';
      const colIdx = colLettersToIndex(colLetters);
      if (colIdx > maxColIdx) maxColIdx = colIdx;

      const typeMatch = /\bt="([^"]+)"/.exec(cellAttrs);
      const cellType = (typeMatch && typeMatch[1]) ? typeMatch[1] : '';

      let cellValue = '';
      if (cellType === 's') {
        // Shared string reference
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellBody);
        if (vMatch && vMatch[1]) {
          const stringIndex = parseInt(vMatch[1], 10);
          cellValue = sharedStrings[stringIndex] || '';
        }
      } else if (cellType === 'inlineStr') {
        const tMatch = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(cellBody);
        if (tMatch && tMatch[1]) {
          cellValue = decodeXmlEntities(tMatch[1]);
        }
      } else {
        // Direct value or number
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(cellBody);
        if (vMatch && vMatch[1]) {
          cellValue = decodeXmlEntities(vMatch[1]);
        }
      }

      const cellByteLength = Buffer.byteLength(cellValue, 'utf8');
      if (cellByteLength > maxCellBytes) {
        throw new IngestionLimitError('MAX_CELL_SIZE', maxCellBytes, cellByteLength);
      }

      rowCellsByIndex.set(colIdx, cellValue);
    }

    // Build dense array of cells
    const cells: string[] = [];
    for (let c = 0; c <= maxColIdx; c++) {
      cells.push(rowCellsByIndex.get(c) || '');
    }

    // Check if fully blank row
    const isBlank = cells.length === 0 || cells.every((c) => c.trim() === '');
    if (isBlank) {
      blankRowsCount++;
      continue;
    }

    if (!headers) {
      headerRowIndex = physicalLinesCount;
      if (cells.length > maxColumns) {
        throw new IngestionLimitError('MAX_COLUMNS', maxColumns, cells.length);
      }
      headers = cells.map((h, idx) => (h && h.trim() !== '' ? h.trim() : `column_${idx + 1}`));
      continue;
    }

    // Data Row
    dataRowCount++;
    if (dataRowCount > maxDataRows) {
      throw new IngestionLimitError('MAX_DATA_ROWS', maxDataRows, dataRowCount);
    }

    if (cells.length > maxColumns) {
      throw new IngestionLimitError('MAX_COLUMNS', maxColumns, cells.length);
    }

    const payload: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      const colName = headers[i] || `column_${i + 1}`;
      payload[colName] = cells[i] !== undefined && cells[i] !== null ? cells[i]! : '';
    }

    const rowHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

    const rawRow: RawRow = {
      batchId,
      sourceRow: dataRowCount,
      headers: [...headers],
      cells: [...cells],
      payload,
      rowHash,
      createdAt: new Date(),
    };

    if (options.onRow) {
      await options.onRow(rawRow);
    } else {
      rows.push(rawRow);
    }
  }

  if (!headers) {
    headers = [];
  }

  const diagnostics: ParserDiagnostics = {
    totalPhysicalLines: physicalLinesCount,
    blankRowsCount,
    headerRowIndex,
    dataRowsCount: dataRowCount,
    columnsCount: headers.length,
    detectedDelimiter: 'xlsx_worksheet_1',
    hasBom: false,
    warnings: [],
  };

  return {
    headers,
    totalDataRows: dataRowCount,
    totalBytes: totalArchiveBytes,
    fileHash,
    diagnostics,
    rows,
  };
}
