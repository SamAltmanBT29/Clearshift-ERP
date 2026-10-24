import { Readable, PassThrough } from 'node:stream';
import { createWriteStream, createReadStream, promises as fs } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { INGESTION_LIMITS, IngestionLimitError } from '@clearshift/contracts';

export interface StorageResult {
  storagePath: string;
  fileSizeBytes: number;
  checksum: string;
}

export interface IFileStorage {
  saveStream(batchId: string, fileName: string, stream: Readable): Promise<StorageResult>;
  getStream(storagePath: string): Readable;
  exists(storagePath: string): Promise<boolean>;
}

/**
 * Restricted Local File Storage Provider (KIT-02)
 * Saves raw source files with SHA-256 calculation and read-only file permissions (0o440).
 */
export class RestrictedLocalFileStorage implements IFileStorage {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir
      ? resolve(baseDir)
      : resolve(process.cwd(), 'storage', 'raw-uploads');
  }

  async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
  }

  async saveStream(
    batchId: string,
    fileName: string,
    stream: Readable,
    maxBytes: number = INGESTION_LIMITS.MAX_FILE_SIZE_BYTES
  ): Promise<StorageResult> {
    await this.ensureDirectory();

    const base = basename(fileName);
    const sanitizedName = base.replace(/[^a-zA-Z0-9._-]/g, '_');
    const targetPath = join(this.baseDir, `${batchId}_${sanitizedName}`);

    const hasher = createHash('sha256');
    let fileSizeBytes = 0;

    const outStream = createWriteStream(targetPath, { mode: 0o644 });

    return new Promise((resolvePromise, rejectPromise) => {
      stream.on('data', (chunk: Buffer) => {
        fileSizeBytes += chunk.length;
        if (fileSizeBytes > maxBytes) {
          stream.destroy();
          outStream.destroy();
          fs.unlink(targetPath).catch(() => {});
          rejectPromise(new IngestionLimitError('MAX_FILE_SIZE', maxBytes, fileSizeBytes));
        }
      });

      // Pass-through to hash and write
      const pass = new PassThrough();
      pass.on('data', (chunk) => hasher.update(chunk));

      stream
        .pipe(pass)
        .pipe(outStream)
        .on('finish', async () => {
          try {
            // Apply read-only permissions (0o440) to prevent tampering
            await fs.chmod(targetPath, 0o440);
            const checksum = hasher.digest('hex');
            resolvePromise({
              storagePath: targetPath,
              fileSizeBytes,
              checksum,
            });
          } catch (err) {
            rejectPromise(err);
          }
        })
        .on('error', (err) => {
          fs.unlink(targetPath).catch(() => {});
          rejectPromise(err);
        });
    });
  }

  getStream(storagePath: string): Readable {
    return createReadStream(storagePath);
  }

  async exists(storagePath: string): Promise<boolean> {
    try {
      await fs.access(storagePath);
      return true;
    } catch {
      return false;
    }
  }
}
