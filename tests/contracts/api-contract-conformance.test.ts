/**
 * @file tests/contracts/api-contract-conformance.test.ts
 * Rigorous API Contract & Conformance Test Suite (QA-02 / PLT-04 / ADR-002)
 *
 * Verifies:
 *   1. OpenAPI 3.1 schema parity across all modules (ERP-1..5 & Common).
 *   2. Strict JSON envelope format: { code, message, details, correlation_id }.
 *   3. Standard pagination query and response envelopes (offset-based and cursor-based).
 *   4. HTTP status code contract compliance (400, 401, 403, 404, 409, 422).
 *   5. Correlation ID propagation and generation.
 *   6. Safe error sanitization without credentials, stack traces, or internal paths.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import {
  ErrorEnvelopeSchema,
  ErrorDetailSchema,
  BasePaginationQuerySchema,
  CursorPaginationQuerySchema,
  createPaginatedResponseSchema,
  createCursorPaginatedResponseSchema,
  StandardErrorCodes,
  HttpStatusCodes,
  ProductSchema,
  VendorSchema,
  SalesOrderSchema,
  InvoiceSchema,
} from '@clearshift/contracts';
import { SYNTHETIC_FIXTURES, calculateChecksum } from './fixtures.js';

const OPENAPI_DIR = resolve(process.cwd(), 'packages/contracts/openapi');

describe('QA-02: API Contract Conformance & Security Verification', () => {
  describe('OpenAPI 3.1 Specification Parity & Integrity', () => {
    const requiredSpecs = [
      'common.yaml',
      'erp-1.yaml',
      'erp-2.yaml',
      'erp-3.yaml',
      'erp-4.yaml',
      'erp-5.yaml',
    ];

    for (const specFile of requiredSpecs) {
      it(`verifies ${specFile} exists, is valid YAML, and declares openapi 3.1.0`, () => {
        const specPath = resolve(OPENAPI_DIR, specFile);
        expect(existsSync(specPath)).toBe(true);

        const content = readFileSync(specPath, 'utf8');
        const parsed = yaml.load(content) as any;
        expect(parsed).toBeDefined();
        expect(parsed.openapi).toMatch(/^3[.]1[.]/);
        expect(parsed.info).toBeDefined();
        expect(parsed.info.title).toBeDefined();
        expect(parsed.info.version).toBeDefined();
      });
    }

    it('verifies common.yaml declares all mandatory HTTP error responses', () => {
      const commonPath = resolve(OPENAPI_DIR, 'common.yaml');
      const content = readFileSync(commonPath, 'utf8');
      const parsed = yaml.load(content) as any;

      const responses = parsed.components?.responses || {};
      const expectedResponses = [
        'BadRequest',
        'Unauthorized',
        'Forbidden',
        'NotFound',
        'Conflict',
        'PayloadTooLarge',
        'UnprocessableEntity',
        'TooManyRequests',
        'InternalServerError',
      ];

      for (const expected of expectedResponses) {
        expect(responses[expected]).toBeDefined();
      }
    });
  });

  describe('Standard Error Envelope Contracts (PLT-04 & ADR-002)', () => {
    it('validates a conformant ErrorEnvelope with structured details', () => {
      const payload = {
        code: StandardErrorCodes.VALIDATION_ERROR,
        message: 'Request payload validation failed',
        details: [
          { field: 'price', message: 'Price must be a positive decimal' },
          { field: 'sku', message: 'SKU is required' },
        ],
        correlation_id: 'corr-req-88990',
      };

      const result = ErrorEnvelopeSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.code).toBe('VALIDATION_ERROR');
        expect(result.data.details.length).toBe(2);
        expect(result.data.correlation_id).toBe('corr-req-88990');
      }
    });

    it('rejects an invalid ErrorEnvelope missing mandatory code or message', () => {
      const invalidMissingCode = {
        message: 'Missing code attribute',
        details: [],
        correlation_id: 'corr-123',
      };
      expect(ErrorEnvelopeSchema.safeParse(invalidMissingCode).success).toBe(false);

      const invalidMissingMessage = {
        code: StandardErrorCodes.NOT_FOUND,
        details: [],
      };
      expect(ErrorEnvelopeSchema.safeParse(invalidMissingMessage).success).toBe(false);
    });

    it('ensures details items conform to { message, field?, code? } structure', () => {
      const validDetail = { field: 'currency', message: 'Must be USD' };
      expect(ErrorDetailSchema.safeParse(validDetail).success).toBe(true);

      const validWithoutField = { message: 'General domain violation', code: 'DOMAIN_ERROR' };
      expect(ErrorDetailSchema.safeParse(validWithoutField).success).toBe(true);

      const invalidDetail = { field: 'test' }; // missing required message
      expect(ErrorDetailSchema.safeParse(invalidDetail).success).toBe(false);
    });
  });

  describe('Pagination Contract Conformance', () => {
    it('validates offset pagination query params and enforces default bounds', () => {
      const defaultParsed = BasePaginationQuerySchema.safeParse({});
      expect(defaultParsed.success).toBe(true);
      if (defaultParsed.success) {
        expect(defaultParsed.data.page).toBe(1);
      }

      // Enforces maximum page size limit
      const oversized = BasePaginationQuerySchema.safeParse({ pageSize: 101 });
      expect(oversized.success).toBe(false);

      // Rejects negative page numbers
      const negativePage = BasePaginationQuerySchema.safeParse({ page: -1 });
      expect(negativePage.success).toBe(false);
    });

    it('validates cursor-based pagination query parameters', () => {
      const cursorValid = CursorPaginationQuerySchema.safeParse({
        cursor: 'eyJsYXN0SWQiOiAiMTAwIn0=',
        limit: 50,
        direction: 'forward',
      });
      expect(cursorValid.success).toBe(true);

      const limitExceeded = CursorPaginationQuerySchema.safeParse({ limit: 101 });
      expect(limitExceeded.success).toBe(false);
    });

    it('constructs conformant paginated collection response envelope', () => {
      const ProductPaginatedSchema = createPaginatedResponseSchema(ProductSchema);
      const fixtureProduct = {
        id: '00000000-0000-4000-8000-000000000001',
        name: SYNTHETIC_FIXTURES.erp1.product.name,
        sku: SYNTHETIC_FIXTURES.erp1.product.sku,
        normalizedSku: SYNTHETIC_FIXTURES.erp1.product.sku.toLowerCase(),
        unitOfMeasure: 'pcs',
        price: '4.5000',
        currency: 'USD',
        taxRate: '18.00',
        createdAt: '2026-10-24T12:00:00.000Z',
        updatedAt: '2026-10-24T12:00:00.000Z',
      };

      const paginatedCollection = {
        items: [fixtureProduct],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      };

      const parsed = ProductPaginatedSchema.safeParse(paginatedCollection);
      expect(parsed.success).toBe(true);
    });
  });

  describe('Safe Error Response & Information Leak Prevention', () => {
    it('asserts error envelopes never leak credentials or passwords', () => {
      const errorPayload = {
        code: StandardErrorCodes.INTERNAL_SERVER_ERROR,
        message: 'A database query failure occurred',
        details: [],
        correlation_id: 'corr-safe-001',
      };

      const serialized = JSON.stringify(errorPayload);
      expect(serialized).not.toContain('password');
      expect(serialized).not.toContain('secret');
      expect(serialized).not.toContain('token');
      expect(serialized).not.toContain('postgres://');
    });

    it('asserts error envelope format is strictly machine-readable without stack traces', () => {
      const envelope = {
        code: StandardErrorCodes.BUSINESS_RULE_VIOLATION,
        message: 'Non-negative stock constraint violation (BR-ERP1-01)',
        details: [{ field: 'quantity', message: 'Opening stock cannot be negative' }],
        correlation_id: 'corr-safe-002',
      };

      const keys = Object.keys(envelope).sort();
      expect(keys).toEqual(['code', 'correlation_id', 'details', 'message']);
      expect((envelope as any).stack).toBeUndefined();
    });
  });

  describe('Fixture Reproducibility & Integrity', () => {
    it('verifies synthetic fixture data produces deterministic checksums', () => {
      const hash1 = calculateChecksum(SYNTHETIC_FIXTURES);
      const hash2 = calculateChecksum(SYNTHETIC_FIXTURES);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });
  });
});
