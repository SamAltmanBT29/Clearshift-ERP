import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { RestrictedLocalFileStorage } from '../../src/ingest/file-storage.js';
import { IngestionLimitError } from '@clearshift/contracts';

describe('RestrictedLocalFileStorage (KIT-02)', () => {
  let tempDir: string;
  let storage: RestrictedLocalFileStorage;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `kit-storage-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
    storage = new RestrictedLocalFileStorage(tempDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('saves streamed content to disk with correct SHA-256 and read-only permissions (0o440)', async () => {
    const payload = 'account_id,name\n1001,Acme\n1002,Beta\n';
    const stream = Readable.from(Buffer.from(payload, 'utf8'));
    const expectedHash = createHash('sha256').update(payload).digest('hex');

    const result = await storage.saveStream('batch-123', 'sample.csv', stream);

    expect(result.fileSizeBytes).toBe(Buffer.byteLength(payload, 'utf8'));
    expect(result.checksum).toBe(expectedHash);
    expect(await storage.exists(result.storagePath)).toBe(true);

    // Verify disk content
    const savedContent = await fs.readFile(result.storagePath, 'utf8');
    expect(savedContent).toBe(payload);

    // Verify 0o440 read-only file mode
    const stats = await fs.stat(result.storagePath);
    // mode includes file type bits; mask with 0o777
    const permissions = stats.mode & 0o777;
    expect(permissions).toBe(0o440);
  });

  it('sanitizes unsafe characters in file names', async () => {
    const stream = Readable.from(Buffer.from('data', 'utf8'));
    const result = await storage.saveStream('batch-456', '../../etc/evil#file!.csv', stream);

    expect(result.storagePath).not.toContain('..');
    expect(result.storagePath).toContain('batch-456_evil_file_.csv');
    expect(await storage.exists(result.storagePath)).toBe(true);
  });

  it('rejects files exceeding maxBytes and cleans up partial file', async () => {
    const chunk = Buffer.alloc(1024, 'A');
    const stream = Readable.from([chunk, chunk, chunk]); // 3 KiB

    // Set limit to 2 KiB
    await expect(
      storage.saveStream('batch-overflow', 'overflow.csv', stream, 2048)
    ).rejects.toThrow(IngestionLimitError);

    // Verify target file was removed
    const files = await fs.readdir(tempDir);
    expect(files).toHaveLength(0);
  });

  it('reads back saved files through getStream()', async () => {
    const payload = 'col1,col2\nval1,val2\n';
    const stream = Readable.from(Buffer.from(payload, 'utf8'));
    const result = await storage.saveStream('batch-read', 'read.csv', stream);

    const readStream = storage.getStream(result.storagePath);
    const chunks: Buffer[] = [];
    for await (const chunk of readStream) {
      chunks.push(chunk as Buffer);
    }
    const retrieved = Buffer.concat(chunks).toString('utf8');
    expect(retrieved).toBe(payload);
  });
});
