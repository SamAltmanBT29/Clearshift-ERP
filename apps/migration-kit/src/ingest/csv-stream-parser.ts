import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import {
  INGESTION_LIMITS,
  IngestionLimitError,
  InvalidEncodingError,
  MalformedFileError,
  ParserDiagnostics,
  RawRow,
  CsvDelimiter,
} from '@clearshift/contracts';

export interface CsvParserOptions {
  batchId?: string;
  delimiter?: CsvDelimiter;
  maxSizeBytes?: number;
  maxColumns?: number;
  maxDataRows?: number;
  maxCellSizeBytes?: number;
  onRow?: (row: RawRow) => Promise<void> | void;
}

export interface CsvParseResult {
  headers: string[];
  totalDataRows: number;
  totalBytes: number;
  fileHash: string;
  diagnostics: ParserDiagnostics;
  rows: RawRow[];
}

/**
 * Streaming RFC-4180 CSV Parser
 * Handles streaming UTF-8 chunks, BOM removal, multiline quoted fields,
 * blank physical row diagnostics, and strict boundary limit enforcement.
 */
export async function parseCsvStream(
  inputStream: Readable,
  options: CsvParserOptions = {}
): Promise<CsvParseResult> {
  const batchId = options.batchId || '00000000-0000-0000-0000-000000000000';
  const delimiter = options.delimiter || ',';
  const maxBytes = options.maxSizeBytes ?? INGESTION_LIMITS.MAX_FILE_SIZE_BYTES;
  const maxColumns = options.maxColumns ?? INGESTION_LIMITS.MAX_COLUMNS;
  const maxDataRows = options.maxDataRows ?? INGESTION_LIMITS.MAX_DATA_ROWS;
  const maxCellBytes = options.maxCellSizeBytes ?? INGESTION_LIMITS.MAX_CELL_SIZE_BYTES;

  const fileHasher = createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  let totalBytes = 0;
  let headers: string[] | null = null;
  let dataRowCount = 0;
  let physicalLinesCount = 0;
  let blankRowsCount = 0;
  let headerRowIndex = 0;
  let hasBom = false;

  const rows: RawRow[] = [];

  // Parser state
  let inQuotes = false;
  let currentCell = '';
  let currentCellBytes = 0;
  let currentRowCells: string[] = [];
  let isCurrentRowAllBlank = true;
  let sawAnyCharsInRow = false;
  let firstCharOfFirstHeader = true;

  const emitRow = async (cells: string[]) => {
    physicalLinesCount++;

    // Check if entire row is whitespace/blank
    const isBlank = cells.every((c) => c.trim() === '');
    if (isBlank) {
      blankRowsCount++;
      return;
    }

    if (!headers) {
      headerRowIndex = physicalLinesCount;
      // Strip UTF-8 BOM only if present at the very start of the first header
      if (cells.length > 0 && cells[0] && cells[0].charCodeAt(0) === 0xfeff) {
        hasBom = true;
        cells[0] = cells[0].substring(1);
      }

      if (cells.length > maxColumns) {
        throw new IngestionLimitError('MAX_COLUMNS', maxColumns, cells.length);
      }

      headers = cells.map((h, idx) => (h && h.trim() !== '' ? h.trim() : `column_${idx + 1}`));
      return;
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
  };

  const processChar = async (ch: string) => {
    sawAnyCharsInRow = true;

    if (inQuotes) {
      if (ch === '"') {
        // Will check for escaped quote in main loop
        inQuotes = false;
      } else {
        currentCell += ch;
        currentCellBytes += Buffer.byteLength(ch, 'utf8');
        if (currentCellBytes > maxCellBytes) {
          throw new IngestionLimitError('MAX_CELL_SIZE', maxCellBytes, currentCellBytes);
        }
      }
      isCurrentRowAllBlank = false;
      return;
    }

    if (ch === '"') {
      if (currentCell.length === 0) {
        inQuotes = true;
        isCurrentRowAllBlank = false;
        return;
      }
      // Stray unescaped quote inside unquoted field
      currentCell += ch;
      currentCellBytes += Buffer.byteLength(ch, 'utf8');
      if (currentCellBytes > maxCellBytes) {
        throw new IngestionLimitError('MAX_CELL_SIZE', maxCellBytes, currentCellBytes);
      }
      return;
    }

    if (ch === delimiter) {
      currentRowCells.push(currentCell);
      currentCell = '';
      currentCellBytes = 0;
      return;
    }

    if (ch === '\r') {
      // Handled with \n or alone
      return;
    }

    if (ch === '\n') {
      currentRowCells.push(currentCell);
      currentCell = '';
      currentCellBytes = 0;

      const cellsToEmit = [...currentRowCells];
      currentRowCells = [];
      sawAnyCharsInRow = false;
      isCurrentRowAllBlank = true;

      await emitRow(cellsToEmit);
      return;
    }

    // Normal character
    currentCell += ch;
    currentCellBytes += Buffer.byteLength(ch, 'utf8');
    if (ch.trim() !== '') {
      isCurrentRowAllBlank = false;
    }
    if (currentCellBytes > maxCellBytes) {
      throw new IngestionLimitError('MAX_CELL_SIZE', maxCellBytes, currentCellBytes);
    }
  };

  for await (const chunk of inputStream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    fileHasher.update(buf);

    if (totalBytes > maxBytes) {
      throw new IngestionLimitError('MAX_FILE_SIZE', maxBytes, totalBytes);
    }

    let textChunk: string;
    try {
      textChunk = decoder.decode(buf, { stream: true });
    } catch (err) {
      throw new InvalidEncodingError(
        `Invalid UTF-8 byte sequence encountered at byte ${totalBytes - buf.length}`
      );
    }

    for (let i = 0; i < textChunk.length; i++) {
      const ch = textChunk[i];

      // Handle escaped quote inside quotes: "" -> "
      if (inQuotes && ch === '"') {
        const nextChar = i + 1 < textChunk.length ? textChunk[i + 1] : null;
        if (nextChar === '"') {
          currentCell += '"';
          currentCellBytes += 1;
          i++; // skip next quote
          if (currentCellBytes > maxCellBytes) {
            throw new IngestionLimitError('MAX_CELL_SIZE', maxCellBytes, currentCellBytes);
          }
          continue;
        }
      }

      if (ch) {
        await processChar(ch);
      }
    }
  }

  // Flush decoder
  try {
    const remaining = decoder.decode();
    for (let i = 0; i < remaining.length; i++) {
      const rem = remaining[i];
      if (rem) {
        await processChar(rem);
      }
    }
  } catch (err) {
    throw new InvalidEncodingError('Invalid trailing UTF-8 byte sequence at end of file');
  }

  // Unclosed quotes at end of file
  if (inQuotes) {
    throw new MalformedFileError('Unclosed quote reached end of file');
  }

  // Process trailing row if stream ended without trailing newline
  if (sawAnyCharsInRow || currentCell.length > 0 || currentRowCells.length > 0) {
    currentRowCells.push(currentCell);
    await emitRow([...currentRowCells]);
  }

  if (!headers) {
    headers = [];
  }

  const fileHash = fileHasher.digest('hex');

  const diagnostics: ParserDiagnostics = {
    totalPhysicalLines: physicalLinesCount,
    blankRowsCount,
    headerRowIndex,
    dataRowsCount: dataRowCount,
    columnsCount: headers.length,
    detectedDelimiter: delimiter,
    hasBom,
    warnings: [],
  };

  return {
    headers,
    totalDataRows: dataRowCount,
    totalBytes,
    fileHash,
    diagnostics,
    rows,
  };
}
