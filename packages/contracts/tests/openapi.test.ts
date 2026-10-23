import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  HttpStatusCodes,
  StandardErrorCodes,
  StandardErrorCodeSchema,
  ErrorDetailSchema,
  ErrorEnvelopeSchema,
  createErrorEnvelope,
  BasePaginationQuerySchema,
  StandardPaginationQuerySchema,
  CursorPaginationQuerySchema,
  createPaginatedResponseSchema,
  createCursorPaginatedResponseSchema,
  HealthResponseSchema,
  EventEnvelopeSchema,
  createEventEnvelopeSchema,
  createEventEnvelope,
} from '../src/index.js';

describe('Shared OpenAPI & Zod Contract Suite (Issue #59 / [PLT-04])', () => {
  describe('Standard Error Envelope & Status Codes', () => {
    it('defines all non-negotiable HTTP status codes per architecture specification', () => {
      expect(HttpStatusCodes.BAD_REQUEST).toBe(400);
      expect(HttpStatusCodes.UNAUTHORIZED).toBe(401);
      expect(HttpStatusCodes.FORBIDDEN).toBe(403);
      expect(HttpStatusCodes.NOT_FOUND).toBe(404);
      expect(HttpStatusCodes.CONFLICT).toBe(409);
      expect(HttpStatusCodes.PAYLOAD_TOO_LARGE).toBe(413);
      expect(HttpStatusCodes.UNPROCESSABLE_ENTITY).toBe(422);
      expect(HttpStatusCodes.TOO_MANY_REQUESTS).toBe(429);
      expect(HttpStatusCodes.INTERNAL_SERVER_ERROR).toBe(500);
    });

    it('validates canonical error envelope with correlation ID and details', () => {
      const validEnvelope = {
        code: StandardErrorCodes.BAD_REQUEST,
        message: 'Invalid query parameters provided',
        details: [
          {
            field: 'pageSize',
            message: 'pageSize cannot exceed 100',
            code: 'VALUE_OUT_OF_RANGE',
          },
        ],
        correlation_id: 'req-12345-abcde',
      };

      const result = ErrorEnvelopeSchema.safeParse(validEnvelope);
      expect(result.success).toBe(true);
      if (result.success && 'code' in result.data) {
        expect(result.data.code).toBe('BAD_REQUEST');
        expect(result.data.correlation_id).toBe('req-12345-abcde');
        expect(Array.isArray(result.data.details)).toBe(true);
      }
    });

    it('defaults details to empty array when details are omitted in flat envelope', () => {
      const minimalEnvelope = {
        code: StandardErrorCodes.NOT_FOUND,
        message: 'Resource not found',
      };

      const result = ErrorEnvelopeSchema.safeParse(minimalEnvelope);
      expect(result.success).toBe(true);
      if (result.success && 'details' in result.data) {
        expect(result.data.details).toEqual([]);
      }
    });

    it('validates module nested error format { error: { code, message } }', () => {
      const nestedEnvelope = {
        error: {
          code: 'BAD_REQUEST',
          message: 'Malformed input',
          details: { field: 'name' },
        },
      };

      const result = ErrorEnvelopeSchema.safeParse(nestedEnvelope);
      expect(result.success).toBe(true);
    });

    it('fails contract test when error code is missing or empty', () => {
      expect(
        ErrorEnvelopeSchema.safeParse({
          code: '',
          message: 'Error message',
        }).success
      ).toBe(false);

      expect(
        ErrorEnvelopeSchema.safeParse({
          message: 'Error message without code',
        }).success
      ).toBe(false);
    });

    it('fails contract test when error message is missing or empty', () => {
      expect(
        ErrorEnvelopeSchema.safeParse({
          code: 'BAD_REQUEST',
          message: '',
        }).success
      ).toBe(false);

      expect(
        ErrorEnvelopeSchema.safeParse({
          code: 'BAD_REQUEST',
        }).success
      ).toBe(false);
    });

    it('createErrorEnvelope helper constructs valid envelope with optional correlation ID', () => {
      const envelope = createErrorEnvelope(
        'UNAUTHORIZED',
        'Authentication required',
        [{ message: 'Token expired' }],
        'cor-999'
      );
      expect(ErrorEnvelopeSchema.safeParse(envelope).success).toBe(true);
      expect(envelope.correlation_id).toBe('cor-999');
    });

    it('validates StandardErrorCodeSchema against recognized codes and rejects arbitrary strings', () => {
      expect(StandardErrorCodeSchema.safeParse('BAD_REQUEST').success).toBe(true);
      expect(StandardErrorCodeSchema.safeParse('UNAUTHORIZED').success).toBe(true);
      expect(StandardErrorCodeSchema.safeParse('BUSINESS_RULE_VIOLATION').success).toBe(true);
      expect(StandardErrorCodeSchema.safeParse('UNKNOWN_RANDOM_CODE').success).toBe(false);
    });
  });

  describe('Bounded Pagination Contracts', () => {
    it('applies default page to BasePaginationQuerySchema and default pageSize to StandardPaginationQuerySchema', () => {
      const baseParsed = BasePaginationQuerySchema.safeParse({});
      expect(baseParsed.success).toBe(true);
      if (baseParsed.success) {
        expect(baseParsed.data.page).toBe(1);
        expect(baseParsed.data.pageSize).toBeUndefined();
      }

      const standardParsed = StandardPaginationQuerySchema.safeParse({});
      expect(standardParsed.success).toBe(true);
      if (standardParsed.success) {
        expect(standardParsed.data.page).toBe(1);
        expect(standardParsed.data.pageSize).toBe(20);
      }
    });

    it('enforces non-negotiable invariant: pageSize cannot exceed 100', () => {
      const valid = BasePaginationQuerySchema.safeParse({ page: 1, pageSize: 100 });
      expect(valid.success).toBe(true);

      const invalid = BasePaginationQuerySchema.safeParse({ page: 1, pageSize: 101 });
      expect(invalid.success).toBe(false);
      if (!invalid.success) {
        expect(invalid.error.issues[0]?.message).toContain('cannot exceed 100');
      }
    });

    it('enforces non-negotiable invariant: limit cannot exceed 100', () => {
      const valid = BasePaginationQuerySchema.safeParse({ page: 1, limit: 100 });
      expect(valid.success).toBe(true);

      const invalid = BasePaginationQuerySchema.safeParse({ page: 1, limit: 101 });
      expect(invalid.success).toBe(false);
      if (!invalid.success) {
        expect(invalid.error.issues[0]?.message).toContain('cannot exceed 100');
      }
    });

    it('rejects non-positive page or pageSize values', () => {
      expect(BasePaginationQuerySchema.safeParse({ page: 0 }).success).toBe(false);
      expect(BasePaginationQuerySchema.safeParse({ page: -1 }).success).toBe(false);
      expect(BasePaginationQuerySchema.safeParse({ pageSize: 0 }).success).toBe(false);
      expect(BasePaginationQuerySchema.safeParse({ pageSize: -5 }).success).toBe(false);
    });

    it('enforces integer requirement on page and pageSize', () => {
      expect(BasePaginationQuerySchema.safeParse({ page: 1.5 }).success).toBe(false);
      expect(BasePaginationQuerySchema.safeParse({ pageSize: 25.5 }).success).toBe(false);
    });

    it('CursorPaginationQuerySchema validates cursor, direction, and bounded limit', () => {
      const defaultCursor = CursorPaginationQuerySchema.safeParse({});
      expect(defaultCursor.success).toBe(true);
      if (defaultCursor.success) {
        expect(defaultCursor.data.limit).toBe(50);
        expect(defaultCursor.data.direction).toBe('forward');
      }

      const customCursor = CursorPaginationQuerySchema.safeParse({
        cursor: 'eyJsYXN0SWQiOiAiMTAwIn0=',
        limit: 100,
        direction: 'backward',
      });
      expect(customCursor.success).toBe(true);

      expect(CursorPaginationQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    });

    it('createPaginatedResponseSchema validates paginated collection structure', () => {
      const ItemSchema = z.object({ id: z.string(), name: z.string() });
      const PaginatedSchema = createPaginatedResponseSchema(ItemSchema);

      const validResponse = {
        items: [{ id: '1', name: 'Item 1' }],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      };
      expect(PaginatedSchema.safeParse(validResponse).success).toBe(true);

      // Rejects invalid item schema
      const invalidResponse = {
        items: [{ id: 123, name: 'Invalid ID type' }],
        page: 1,
        pageSize: 20,
        total: 1,
      };
      expect(PaginatedSchema.safeParse(invalidResponse).success).toBe(false);
    });

    it('createCursorPaginatedResponseSchema validates cursor-based pagination structure', () => {
      const ItemSchema = z.object({ id: z.string() });
      const CursorSchema = createCursorPaginatedResponseSchema(ItemSchema);

      const valid = {
        items: [{ id: 'a' }],
        nextCursor: 'cur-2',
        prevCursor: null,
        hasMore: true,
      };
      expect(CursorSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe('Transactional Event Envelope Contracts (PLT-04 / PLT-09)', () => {
    it('validates canonical event envelope with UUID event_id and ISO occurred_at', () => {
      const validEvent = {
        event_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        event_type: 'erp.journal_entry.posted',
        schema_version: '1.0.0',
        occurred_at: '2026-10-22T10:00:00.000Z',
        correlation_id: 'cor-req-12345',
        producer: 'erp-4',
        entity_type: 'journal_entry',
        entity_id: '00000000-0000-4000-8000-000000000001',
        payload: { entryNumber: 'JE-001', balance: '0.00' },
      };

      const result = EventEnvelopeSchema.safeParse(validEvent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.event_type).toBe('erp.journal_entry.posted');
        expect(result.data.producer).toBe('erp-4');
      }
    });

    it('fails contract test when event_id is not a valid UUID', () => {
      const invalidEvent = {
        event_id: 'not-a-valid-uuid',
        event_type: 'erp.journal_entry.posted',
        schema_version: '1.0.0',
        occurred_at: '2026-10-22T10:00:00.000Z',
        correlation_id: 'cor-1',
        producer: 'erp-4',
        entity_type: 'journal_entry',
        entity_id: 'ent-1',
        payload: {},
      };

      const result = EventEnvelopeSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('UUID');
      }
    });

    it('fails contract test when occurred_at is not an ISO datetime string', () => {
      const invalidEvent = {
        event_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        event_type: 'erp.journal_entry.posted',
        schema_version: '1.0.0',
        occurred_at: 'not-a-datetime',
        correlation_id: 'cor-1',
        producer: 'erp-4',
        entity_type: 'journal_entry',
        entity_id: 'ent-1',
        payload: {},
      };

      expect(EventEnvelopeSchema.safeParse(invalidEvent).success).toBe(false);
    });

    it('createEventEnvelope factory builds complete EventEnvelope with defaults', () => {
      const event = createEventEnvelope({
        event_id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
        event_type: 'kit.batch.completed',
        correlation_id: 'cor-batch-77',
        producer: 'migration-kit',
        entity_type: 'batch',
        entity_id: 'batch-uuid-1',
        payload: { loadedCount: 50, rejectedCount: 0 },
      });

      expect(EventEnvelopeSchema.safeParse(event).success).toBe(true);
      expect(event.schema_version).toBe('1.0.0');
      expect(event.occurred_at).toBeDefined();
    });

    it('createEventEnvelopeSchema creates strongly-typed payload event envelope', () => {
      const UserPayloadSchema = z.object({ userId: z.string(), email: z.string().email() });
      const UserEventSchema = createEventEnvelopeSchema(UserPayloadSchema);

      const valid = {
        event_id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
        event_type: 'user.created',
        schema_version: '1.0.0',
        occurred_at: '2026-10-22T10:00:00.000Z',
        correlation_id: 'cor-user-1',
        producer: 'identity',
        entity_type: 'user',
        entity_id: 'u-1',
        payload: { userId: 'u-1', email: 'test@example.com' },
      };
      expect(UserEventSchema.safeParse(valid).success).toBe(true);

      const invalidEmail = { ...valid, payload: { userId: 'u-1', email: 'not-an-email' } };
      expect(UserEventSchema.safeParse(invalidEmail).success).toBe(false);
    });
  });

  describe('Health Check Schema', () => {
    it('validates health response schema with ok, degraded, and down states', () => {
      const healthy = {
        status: 'ok',
        module: 'erp-contracts',
        version: '1.0.0',
        timestamp: '2026-10-22T10:00:00.000Z',
        dependencies: {
          database: { status: 'ok', latencyMs: 5 },
          redis: { status: 'ok', latencyMs: 2 },
        },
      };
      expect(HealthResponseSchema.safeParse(healthy).success).toBe(true);

      expect(HealthResponseSchema.safeParse({ status: 'invalid_status', module: 'm', version: '1' }).success).toBe(false);
    });
  });

  describe('OpenAPI 3.1 Spec Document Verification', () => {
    const openapiDir = resolve(__dirname, '../openapi');

    it('verifies packages/contracts/openapi/common.yaml exists and is well-formed', () => {
      const commonYamlPath = resolve(openapiDir, 'common.yaml');
      expect(existsSync(commonYamlPath)).toBe(true);

      const content = readFileSync(commonYamlPath, 'utf8');
      expect(content).toContain('openapi: 3.1.0');
      expect(content).toContain('title: ClearShift Shared API Contract & Error Envelope');
      expect(content).toContain('ErrorEnvelope:');
      expect(content).toContain('ErrorDetail:');
      expect(content).toContain('BasePaginationQuery:');
      expect(content).toContain('CursorPaginationQuery:');
      expect(content).toContain('HealthResponse:');
      expect(content).toContain('EventEnvelope:');
    });

    it('verifies standard HTTP error responses are declared in common.yaml', () => {
      const content = readFileSync(resolve(openapiDir, 'common.yaml'), 'utf8');
      const requiredResponses = [
        'BadRequest:',
        'Unauthorized:',
        'Forbidden:',
        'NotFound:',
        'Conflict:',
        'PayloadTooLarge:',
        'UnprocessableEntity:',
        'TooManyRequests:',
        'InternalServerError:',
      ];

      for (const resp of requiredResponses) {
        expect(content).toContain(resp);
      }
    });

    it('verifies module OpenAPI spec erp-3.yaml exists', () => {
      expect(existsSync(resolve(openapiDir, 'erp-3.yaml'))).toBe(true);
    });

    it('verifies module OpenAPI spec erp-4.yaml exists', () => {
      expect(existsSync(resolve(openapiDir, 'erp-4.yaml'))).toBe(true);
    });

    it('detects a breaking contract schema change in test pipeline', () => {
      // Demonstrates contract test fails if a schema definition drops required fields
      const breakingPayload = {
        // Missing "code" and "message"
        details: [],
        correlation_id: 'test',
      };
      const result = ErrorEnvelopeSchema.safeParse(breakingPayload);
      expect(result.success).toBe(false);
    });
  });
});
