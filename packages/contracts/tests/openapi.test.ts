import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ErrorEnvelopeSchema,
  createErrorEnvelope,
  PaginationQuerySchema,
  CursorPaginationQuerySchema,
  computePaginationMeta,
  createPaginatedResponseSchema,
  HttpStatusCodes,
  StandardErrorCodes,
  MAX_PAGE_SIZE,
} from '../src/common.js';
import {
  EventEnvelopeSchema,
  createEventEnvelope,
} from '../src/events.js';
import { z } from 'zod';

describe('[PLT-04] Shared API Contract and Error Envelope Tests', () => {
  describe('Error Envelope Invariants', () => {
    it('validates standard error envelope with code, message, safe details and correlation_id', () => {
      const validPayload = {
        code: StandardErrorCodes.BAD_REQUEST,
        message: 'Invalid query parameters supplied',
        details: [
          {
            field: 'pageSize',
            message: 'pageSize cannot exceed 100',
            code: 'MAX_LIMIT_EXCEEDED',
          },
        ],
        correlation_id: 'corr-12345-uuid',
      };

      const result = ErrorEnvelopeSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.code).toBe('BAD_REQUEST');
        expect(result.data.message).toBe('Invalid query parameters supplied');
        expect(result.data.correlation_id).toBe('corr-12345-uuid');
      }
    });

    it('rejects invalid error payload missing required code or message', () => {
      const missingCode = {
        message: 'Something went wrong',
      };
      expect(ErrorEnvelopeSchema.safeParse(missingCode).success).toBe(false);

      const missingMessage = {
        code: 'INTERNAL_ERROR',
      };
      expect(ErrorEnvelopeSchema.safeParse(missingMessage).success).toBe(false);
    });

    it('creates standardized error envelope via createErrorEnvelope helper', () => {
      const envelope = createErrorEnvelope({
        code: StandardErrorCodes.NOT_FOUND,
        message: 'Entity with specified ID not found',
        correlationId: 'req-abc-999',
        details: { entityId: 'uuid-123' },
      });

      expect(envelope.code).toBe(StandardErrorCodes.NOT_FOUND);
      expect(envelope.message).toBe('Entity with specified ID not found');
      expect(envelope.correlationId).toBe('req-abc-999');
      expect(envelope.correlation_id).toBe('req-abc-999');
      expect(ErrorEnvelopeSchema.safeParse(envelope).success).toBe(true);
    });

    it('enforces non-negotiable HTTP status codes per PLT-04 constraint', () => {
      expect(HttpStatusCodes.BAD_REQUEST).toBe(400);
      expect(HttpStatusCodes.UNAUTHENTICATED).toBe(401);
      expect(HttpStatusCodes.FORBIDDEN).toBe(403);
      expect(HttpStatusCodes.NOT_FOUND).toBe(404);
      expect(HttpStatusCodes.CONFLICT).toBe(409);
      expect(HttpStatusCodes.PAYLOAD_TOO_LARGE).toBe(413);
      expect(HttpStatusCodes.UNPROCESSABLE_ENTITY).toBe(422);
      expect(HttpStatusCodes.TOO_MANY_REQUESTS).toBe(429);
      expect(HttpStatusCodes.INTERNAL_SERVER_ERROR).toBe(500);
    });
  });

  describe('Bounded Pagination Constraints', () => {
    it('applies default pagination values (page: 1, pageSize: 25)', () => {
      const parsed = PaginationQuerySchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.pageSize).toBe(25);
    });

    it('accepts valid bounded pageSize up to MAX_PAGE_SIZE (100)', () => {
      const parsed = PaginationQuerySchema.parse({ page: '2', pageSize: '100' });
      expect(parsed.page).toBe(2);
      expect(parsed.pageSize).toBe(100);
    });

    it('strictly rejects pageSize exceeding 100 as invalid request', () => {
      const result = PaginationQuerySchema.safeParse({ page: 1, pageSize: 101 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]?.message).toContain(`cannot exceed ${MAX_PAGE_SIZE}`);
      }
    });

    it('strictly rejects non-positive page numbers', () => {
      expect(PaginationQuerySchema.safeParse({ page: 0 }).success).toBe(false);
      expect(PaginationQuerySchema.safeParse({ page: -5 }).success).toBe(false);
    });

    it('computes pagination meta correctly', () => {
      const meta = computePaginationMeta({ page: 2, pageSize: 20, total: 55 });
      expect(meta.totalPages).toBe(3);
      expect(meta.hasNextPage).toBe(true);
      expect(meta.hasPrevPage).toBe(true);
    });

    it('creates and validates paginated response envelope', () => {
      const ItemSchema = z.object({ id: z.string(), name: z.string() });
      const PaginatedSchema = createPaginatedResponseSchema(ItemSchema);

      const validResponse = {
        items: [{ id: '1', name: 'Item 1' }],
        meta: {
          page: 1,
          pageSize: 25,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      };
      expect(PaginatedSchema.safeParse(validResponse).success).toBe(true);

      // Invalid item payload must fail contract test
      const invalidResponse = {
        items: [{ id: 123 }], // id is number instead of string, missing name
        meta: validResponse.meta,
      };
      expect(PaginatedSchema.safeParse(invalidResponse).success).toBe(false);
    });

    it('enforces limit boundary on cursor pagination for logs/streams', () => {
      const valid = CursorPaginationQuerySchema.parse({ cursor: 'cur_abc', limit: 50 });
      expect(valid.limit).toBe(50);
      expect(valid.cursor).toBe('cur_abc');

      const overLimit = CursorPaginationQuerySchema.safeParse({ limit: 150 });
      expect(overLimit.success).toBe(false);
    });
  });

  describe('Outbox Event Envelope Invariants', () => {
    it('creates and parses valid EventEnvelope', () => {
      const event = createEventEnvelope({
        eventType: 'crm.contact.created',
        aggregateType: 'Contact',
        aggregateId: '00000000-0000-4000-8000-000000000001',
        payload: { email: 'test@clearshift.synthetic', firstName: 'John' },
        correlationId: 'corr-event-001',
      });

      expect(event.eventType).toBe('crm.contact.created');
      expect(event.aggregateType).toBe('Contact');
      expect(event.producer).toBe('clearshift');
      expect(event.version).toBe(1);
      expect(EventEnvelopeSchema.safeParse(event).success).toBe(true);
    });

    it('rejects invalid event envelope with non-UUID id or missing aggregateId', () => {
      const invalidEvent = {
        id: 'not-a-uuid',
        eventType: 'crm.contact.created',
        aggregateType: 'Contact',
        aggregateId: '1',
        timestamp: new Date().toISOString(),
        version: 1,
        producer: 'clearshift',
        payload: {},
      };
      expect(EventEnvelopeSchema.safeParse(invalidEvent).success).toBe(false);
    });
  });

  describe('OpenAPI Spec Contract Baseline', () => {
    it('validates common.yaml exists and defines all required HTTP status error envelopes', () => {
      const commonYamlPath = resolve(__dirname, '../openapi/common.yaml');
      const yamlContent = readFileSync(commonYamlPath, 'utf8');

      expect(yamlContent).toContain('openapi: 3.1.0');
      expect(yamlContent).toContain('ErrorEnvelope:');
      expect(yamlContent).toContain('PaginationMeta:');
      expect(yamlContent).toContain('EventEnvelope:');
      expect(yamlContent).toContain('maximum: 100');

      // Verify all required status codes are represented in responses
      const requiredResponses = [
        'BadRequest',
        'Unauthenticated',
        'Forbidden',
        'NotFound',
        'Conflict',
        'PayloadTooLarge',
        'UnprocessableEntity',
        'TooManyRequests',
        'InternalServerError',
      ];
      for (const resp of requiredResponses) {
        expect(yamlContent).toContain(`${resp}:`);
      }
    });
  });
});
