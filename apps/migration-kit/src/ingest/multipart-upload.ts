import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import { IngestService } from './ingest-service.js';
import { UploadSourceOptions, MalformedFileError } from '@clearshift/contracts';

export interface MultipartUploadRouteOptions {
  ingestService: IngestService;
}

/**
 * Fastify Routes for Streamed Source File Upload (KIT-02)
 * Supports @fastify/multipart streamed uploads with boundary & limit enforcement.
 */
export async function ingestRoutes(
  fastify: FastifyInstance,
  options: MultipartUploadRouteOptions
): Promise<void> {
  const { ingestService } = options;

  fastify.post('/api/v1/migration-kit/batches/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    // Check if multipart handler is available on request (via @fastify/multipart)
    // @ts-expect-error fastify-multipart decorator
    if (typeof request.isMultipart === 'function' && request.isMultipart()) {
      // @ts-expect-error fastify-multipart file getter
      const part = await request.file({
        limits: {
          fileSize: 50 * 1024 * 1024, // 50 MiB
          files: 1,
        },
      });

      if (!part) {
        throw new MalformedFileError('No file part provided in multipart request');
      }

      const fileStream = part.file as Readable;
      const fileName = part.filename || 'uploaded_source.csv';

      // Extract form fields
      const fields = (part.fields as Record<string, { value: unknown }>) || {};
      const module = (fields['module']?.value as string) || 'crm-1';
      const sourceSystem = fields['sourceSystem']?.value as string | undefined;
      const format = (fields['format']?.value as 'csv' | 'xlsx') || (fileName.endsWith('.xlsx') ? 'xlsx' : 'csv');
      const delimiter = (fields['delimiter']?.value as ',' | ';') || ',';
      const dateFormat = fields['dateFormat']?.value as string | undefined;
      const phoneCountry = fields['phoneCountry']?.value as string | undefined;
      const correlationId = (request.headers['x-correlation-id'] as string) || undefined;
      // @ts-expect-error auth decorator if present
      const actor = request.user?.username || 'system';

      const uploadOptions: UploadSourceOptions = {
        module,
        sourceSystem,
        format,
        delimiter,
        dateFormat,
        phoneCountry,
        correlationId,
        actor,
      };

      const result = await ingestService.ingestSourceStream(fileStream, fileName, uploadOptions);
      return reply.status(201).send({ data: result });
    }

    // Direct stream fallback for raw application/octet-stream or CLI uploads
    const contentType = request.headers['content-type'] || '';
    const fileName = (request.headers['x-file-name'] as string) || 'source.csv';
    const module = (request.headers['x-module'] as string) || 'crm-1';
    const delimiter = (request.headers['x-delimiter'] as ',' | ';') || ',';
    const format = (request.headers['x-format'] as 'csv' | 'xlsx') || (fileName.endsWith('.xlsx') ? 'xlsx' : 'csv');
    const correlationId = (request.headers['x-correlation-id'] as string) || undefined;

    const fileStream = request.raw as Readable;
    const uploadOptions: UploadSourceOptions = {
      module,
      format,
      delimiter,
      correlationId,
      actor: 'system',
    };

    const result = await ingestService.ingestSourceStream(fileStream, fileName, uploadOptions);
    return reply.status(201).send({ data: result });
  });
}
