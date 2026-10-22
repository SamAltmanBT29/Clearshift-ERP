/**
 * ERP-2 Vendors API Test Suite
 *
 * Verifies FR-ERP2-01, FR-ERP2-02, FR-ERP2-06:
 *   - Vendor listing with bounded pagination & search by name
 *   - Vendor CRUD operations
 *   - Server-side bank detail masking (XXXX-XXXX-7890) and negative leakage tests
 *   - Duplicate tax number constraint
 *
 * @module erp2/tests/api/vendors.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { InMemoryErp2Repository } from '../../src/services/repository.js';
import { Erp2Service } from '../../src/services/erp2.service.js';

describe('ERP-2 Vendors REST API (FR-ERP2-01, FR-ERP2-02, FR-ERP2-06)', () => {
  let app: FastifyInstance;
  let repo: InMemoryErp2Repository;
  let service: Erp2Service;

  beforeEach(() => {
    repo = new InMemoryErp2Repository(true); // seeds default Acme vendor
    service = new Erp2Service({ repository: repo });
    app = buildApp({ repository: repo, erp2Service: service });
  });

  describe('GET /api/v1/erp-vendors/vendors', () => {
    it('returns paginated vendor list with default pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.items).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.items[0].name).toBe('Acme Industrial Supplies');
      expect(body.items[0].bank_masked).toBe('XXXX-XXXX-7890');
    });

    it('filters vendors by name search', async () => {
      // Seed another vendor
      await repo.createVendor(
        {
          name: 'Beta Electronics',
          tax_number: 'TX-BETA-01',
          email: 'contact@beta.com',
        },
        'XXXX-XXXX-1122'
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?search=Beta',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].name).toBe('Beta Electronics');
    });

    it('rejects invalid page or pageSize > 100', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors?pageSize=200',
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/erp-vendors/vendors', () => {
    it('creates a new vendor and masks bank details server-side (FR-ERP2-02, FR-ERP2-06)', async () => {
      const payload = {
        name: 'Delta Logistics',
        tax_number: 'TX-DELTA-99',
        email: 'ops@deltalogistics.com',
        phone: '+1-555-8888',
        address_line: '500 Freight Way',
        city: 'Chicago',
        country: 'USA',
        bank_details: '98765432101234', // Raw sensitive bank account number
        currency: 'USD',
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload,
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Delta Logistics');
      expect(body.tax_number).toBe('TX-DELTA-99');
      // Verify mask format XXXX-XXXX-1234 (last 4 digits of 98765432101234 are 1234)
      expect(body.bank_masked).toBe('XXXX-XXXX-1234');
      // Assert raw bank details never leak
      expect(JSON.stringify(body)).not.toContain('98765432101234');
    });

    it('rejects creating vendor with duplicate tax number (HTTP 409)', async () => {
      const payload = {
        name: 'Another Acme Clone',
        tax_number: 'TX-998877', // Same as seeded Acme
        email: 'clone@acme.com',
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/erp-vendors/vendors',
        payload,
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('DUPLICATE_TAX_NUMBER');
    });
  });

  describe('GET /api/v1/erp-vendors/vendors/:id', () => {
    it('retrieves single vendor by UUID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors/00000000-0000-0000-0000-000000000001',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.name).toBe('Acme Industrial Supplies');
      expect(body.bank_masked).toBe('XXXX-XXXX-7890');
    });

    it('returns 404 when vendor does not exist', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/erp-vendors/vendors/99999999-9999-9999-9999-999999999999',
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.payload);
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /api/v1/erp-vendors/vendors/:id', () => {
    it('updates vendor and masks new bank details', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/erp-vendors/vendors/00000000-0000-0000-0000-000000000001',
        payload: {
          phone: '+1-555-9999',
          bank_details: '5555666677778888',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.phone).toBe('+1-555-9999');
      expect(body.bank_masked).toBe('XXXX-XXXX-8888');
      expect(JSON.stringify(body)).not.toContain('5555666677778888');
    });
  });
});
