import { Readable } from 'node:stream';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import {
  RawRow,
  IngestResult,
  UploadSourceOptions,
  UploadSourceOptionsSchema,
  IngestionLimitError,
  InvalidEncodingError,
  SecurityRejectedError,
  MalformedFileError,
} from '@clearshift/contracts';
import { parseCsvStream } from './csv-stream-parser.js';
import { parseXlsxStream } from './xlsx-stream-parser.js';
import { IFileStorage, RestrictedLocalFileStorage } from './file-storage.js';
import { BatchRegistryService } from '../batches/batch-registry.js';
import { rawRows } from '../db/schema.js';

/**
 * Raw Rows Repository Interface
 */
export interface IRawRowsRepository {
  insertBatch(rows: RawRow[]): Promise<void>;
  findByBatchId(batchId: string, limit?: number, offset?: number): Promise<RawRow[]>;
  countByBatchId(batchId: string): Promise<number>;
}

/**
 * In-Memory Raw Rows Repository (Strictly Append-Only)
 */
export class InMemoryRawRowsRepository implements IRawRowsRepository {
  private rows: RawRow[] = [];

  async insertBatch(newRows: RawRow[]): Promise<void> {
    for (const r of newRows) {
      this.rows.push({ ...r });
    }
  }

  async findByBatchId(batchId: string, limit?: number, offset?: number): Promise<RawRow[]> {
    let result = this.rows
      .filter((r) => r.batchId === batchId)
      .sort((a, b) => a.sourceRow - b.sourceRow);

    if (offset) result = result.slice(offset);
    if (limit) result = result.slice(0, limit);
    return result.map((r) => ({ ...r }));
  }

  async countByBatchId(batchId: string): Promise<number> {
    return this.rows.filter((r) => r.batchId === batchId).length;
  }

  // Reject mutation
  update(): never {
    throw new Error('raw_rows is append-only and cannot be mutated');
  }

  delete(): never {
    throw new Error('raw_rows is append-only and cannot be deleted');
  }

  clear(): void {
    this.rows = [];
  }
}

/**
 * Drizzle Database Raw Rows Repository
 */
export class DrizzleRawRowsRepository implements IRawRowsRepository {
  constructor(private db: NodePgDatabase) {}

  async insertBatch(rowsToInsert: RawRow[]): Promise<void> {
    if (rowsToInsert.length === 0) return;

    await this.db.insert(rawRows).values(
      rowsToInsert.map((r) => ({
        batchId: r.batchId,
        sourceRow: r.sourceRow,
        headers: r.headers,
        cells: r.cells,
        payload: r.payload as Record<string, unknown>,
        rowHash: r.rowHash,
        createdAt: r.createdAt || new Date(),
      }))
    );
  }

  async findByBatchId(batchId: string, limit?: number, offset?: number): Promise<RawRow[]> {
    let query = this.db
      .select()
      .from(rawRows)
      .where(eq(rawRows.batchId, batchId))
      .orderBy(rawRows.sourceRow);

    if (limit) {
      // @ts-expect-error Drizzle limit typing
      query = query.limit(limit);
    }
    if (offset) {
      // @ts-expect-error Drizzle offset typing
      query = query.offset(offset);
    }

    const results = await query;
    return results as unknown as RawRow[];
  }

  async countByBatchId(batchId: string): Promise<number> {
    const results = await this.db
      .select({ id: rawRows.id })
      .from(rawRows)
      .where(eq(rawRows.batchId, batchId));
    return results.length;
  }
}

/**
 * Ingestion Service (KIT-02)
 * Coordinates file streaming, local storage persistence, parser execution,
 * batch status transitions, and raw row immutability.
 */
export class IngestService {
  constructor(
    private batchService: BatchRegistryService,
    private storage: IFileStorage = new RestrictedLocalFileStorage(),
    private rawRowsRepo: IRawRowsRepository = new InMemoryRawRowsRepository()
  ) {}

  /**
   * Processes an incoming source file stream
   */
  async ingestSourceStream(
    fileStream: Readable,
    fileName: string,
    rawOptions: UploadSourceOptions
  ): Promise<IngestResult> {
    const options = UploadSourceOptionsSchema.parse(rawOptions);
    const startTime = Date.now();

    // Determine format from options or file extension
    const format =
      options.format ||
      (fileName.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv');

    // 1. Create batch in registry (initial checksum placeholder, updated upon save)
    const initialBatch = await this.batchService.createBatch({
      module: options.module,
      sourceSystem: options.sourceSystem,
      fileName,
      checksum: '0'.repeat(64),
      correlationId: options.correlationId,
      createdBy: options.actor,
      metadata: {
        format,
        declaredDelimiter: options.delimiter,
        dateFormat: options.dateFormat,
        phoneCountry: options.phoneCountry,
      },
    });

    const batchId = initialBatch.id;

    try {
      // 2. Transition batch created -> extracting
      await this.batchService.transitionBatch(batchId, {
        targetStatus: 'extracting',
        actor: options.actor,
        correlationId: options.correlationId,
      });

      // 3. Save stream to restricted local storage while computing SHA-256
      const { storagePath, fileSizeBytes, checksum } = await this.storage.saveStream(
        batchId,
        fileName,
        fileStream
      );

      // 4. Stream and parse from restricted local storage
      const parseStream = this.storage.getStream(storagePath);
      const rowChunkBuffer: RawRow[] = [];
      const CHUNK_SIZE = 500;

      const onRow = async (row: RawRow) => {
        rowChunkBuffer.push(row);
        if (rowChunkBuffer.length >= CHUNK_SIZE) {
          const chunk = [...rowChunkBuffer];
          rowChunkBuffer.length = 0;
          await this.rawRowsRepo.insertBatch(chunk);
        }
      };

      let parseResult;
      if (format === 'xlsx') {
        parseResult = await parseXlsxStream(parseStream, {
          batchId,
          onRow,
        });
      } else {
        parseResult = await parseCsvStream(parseStream, {
          batchId,
          delimiter: options.delimiter,
          onRow,
        });
      }

      // Flush remainder
      if (rowChunkBuffer.length > 0) {
        await this.rawRowsRepo.insertBatch(rowChunkBuffer);
      }

      const durationMs = Date.now() - startTime;

      // 5. Update batch to extracted with verified checksum and row counts
      await this.batchService.transitionBatch(batchId, {
        targetStatus: 'extracted',
        recordsIn: parseResult.totalDataRows,
        recordsOut: parseResult.totalDataRows,
        actor: options.actor,
        correlationId: options.correlationId,
        durationMs,
        metadata: {
          fileSizeBytes,
          storagePath,
          diagnostics: parseResult.diagnostics,
        },
      });

      return {
        batchId,
        batchNumber: initialBatch.batchNumber,
        fileName,
        fileSizeBytes,
        checksum,
        storagePath,
        headers: parseResult.headers,
        totalDataRows: parseResult.totalDataRows,
        diagnostics: parseResult.diagnostics,
      };
    } catch (err: unknown) {
      // On parsing or limit failure, transition batch to failed safely
      let errorCode = 'FILE_INGESTION_FAILED';
      let errorMessage = 'An error occurred during file ingestion';

      if (err instanceof IngestionLimitError) {
        errorCode = err.limitName;
        errorMessage = err.message;
      } else if (err instanceof InvalidEncodingError) {
        errorCode = err.code;
        errorMessage = err.message;
      } else if (err instanceof SecurityRejectedError) {
        errorCode = err.code;
        errorMessage = err.message;
      } else if (err instanceof MalformedFileError) {
        errorCode = err.code;
        errorMessage = err.message;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }

      await this.batchService.transitionBatch(batchId, {
        targetStatus: 'failed',
        errorCode,
        errorMessage,
        actor: options.actor,
        correlationId: options.correlationId,
      }).catch(() => {});

      throw err;
    }
  }

  async getRawRows(batchId: string, limit?: number, offset?: number): Promise<RawRow[]> {
    return await this.rawRowsRepo.findByBatchId(batchId, limit, offset);
  }
}
