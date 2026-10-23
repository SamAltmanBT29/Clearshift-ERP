/**
 * ERP-1 Products & Inventory — Dirty Data Pack Plan & Migration Profiling Test Suite
 *
 * Validates:
 * - Committed synthetic Dirty Data Pack fixture manifest and SHA-256 checksum
 * - Rule catalogue integrity (rule IDs, actions, explanations, doc references)
 * - Raw input immutability guarantee (BR-KIT-03)
 * - Exact determinism: byte-equivalent profile and zero unaccounted rows
 * - Exact duplicate detection without fuzzy scoring (BR-ERP1-01)
 * - Core domain invariants: BR-ERP1-01, BR-ERP1-02, BR-ERP1-03, FR-ERP1-04, FR-ERP1-05
 * - OWASP formula injection protection (PLT-12 / KIT-16)
 * - Sensitive financial and employee field masking
 * - Strict schema compliance with @clearshift/contracts
 *
 * @module erp1/tests/migration/dirty-data-plan.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DirtyDataProfileReportSchema,
  DataQualityRuleSchema,
  CreateProductInputSchema,
} from '@clearshift/contracts';
import {
  FIXTURE_PATH,
  FIXTURE_SCHEMA_VERSION,
  PROFILE_SCHEMA_VERSION,
  RULES_VERSION,
  RULE_CATALOGUE,
  ACCEPTED_UOMS,
  parseCsv,
  evaluateDataset,
  buildProfile,
  sha256Hex,
  maskSensitiveFields,
  normalizeSku,
  type ProfileReport,
  type RawRow,
} from '../../src/migration/dirty-data-plan.js';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

describe('ERP-1 Canonical Dirty Data Pack Plan & Data Quality Rules', () => {
  const csvText = read(FIXTURE_PATH);
  const expectedProfileText = read('sample-data/erp-1/expected-profile.json');
  const expectedProfile = JSON.parse(expectedProfileText) as ProfileReport;
  const mappingTemplateText = read('sample-data/erp-1/mapping-template.json');
  const mappingTemplate = JSON.parse(mappingTemplateText);

  describe('1. Fixture Manifest & Checksum Integrity', () => {
    it('locates committed dirty-data-v1.csv fixture in sample-data/erp-1/', () => {
      expect(existsSync(resolve(REPO_ROOT, FIXTURE_PATH))).toBe(true);
      expect(csvText.length).toBeGreaterThan(500);
    });

    it('verifies SHA-256 checksum matches expected profile', () => {
      const computedHash = sha256Hex(csvText);
      expect(computedHash).toBe(expectedProfile.fixture_sha256);
      expect(computedHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('verifies schema versions and module identifier', () => {
      expect(expectedProfile.profile_schema_version).toBe(PROFILE_SCHEMA_VERSION);
      expect(expectedProfile.rules_version).toBe(RULES_VERSION);
      expect(expectedProfile.module).toBe('erp1');
      expect(expectedProfile.fixture).toBe(FIXTURE_PATH);
    });

    it('validates mapping template policy guarantees', () => {
      expect(mappingTemplate.module).toBe('erp1');
      expect(mappingTemplate.policy.fuzzy_matching).toBe(false);
      expect(mappingTemplate.policy.automatic_merge).toBe(false);
      expect(mappingTemplate.policy.raw_input_mutation).toBe(false);
      expect(mappingTemplate.load_order).toEqual(['category', 'warehouse', 'product', 'stock_level']);
    });
  });

  describe('2. Raw Input Immutability (BR-KIT-03)', () => {
    it('parses raw CSV into rows without modifying raw cell values', () => {
      const rows = parseCsv(csvText);
      expect(rows.length).toBe(expectedProfile.total_rows);

      // Verify header and row integrity
      const firstProduct = rows.find((r) => r.source_id === 'PRD-001');
      expect(firstProduct).toBeDefined();
      expect(firstProduct?.sku).toBe('FAST-BOLT-HEX-001');
      expect(firstProduct?.price).toBe('12.5000');
      expect(firstProduct?.currency).toBe('USD');

      // Re-hash remains unchanged
      expect(sha256Hex(csvText)).toBe(expectedProfile.fixture_sha256);
    });
  });

  describe('3. Rule Catalogue Integrity', () => {
    it('defines unique stable rule IDs across all rules', () => {
      const ids = RULE_CATALOGUE.map((r) => r.rule_id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('validates every rule against DataQualityRuleSchema', () => {
      for (const rule of RULE_CATALOGUE) {
        const parsed = DataQualityRuleSchema.parse(rule);
        expect(parsed.version).toBe('1.0.0');
        expect(parsed.doc_reference.length).toBeGreaterThan(0);
        expect(parsed.explanation.length).toBeGreaterThan(0);
      }
    });

    it('covers all four ERP-1 entities: category, warehouse, product, stock_level', () => {
      const entities = new Set(RULE_CATALOGUE.map((r) => r.record_type));
      expect(entities.has('category')).toBe(true);
      expect(entities.has('warehouse')).toBe(true);
      expect(entities.has('product')).toBe(true);
      expect(entities.has('stock_level')).toBe(true);
    });
  });

  describe('4. Deterministic Profiling & Exact Defect Distribution', () => {
    const rawRows = parseCsv(csvText);
    const evaluatedRows = evaluateDataset(rawRows);
    const profile = buildProfile(csvText, evaluatedRows);

    it('produces byte-equivalent reconciliation numbers matching expected profile', () => {
      expect(profile.total_rows).toBe(expectedProfile.total_rows);
      expect(profile.reconciliation.accepted).toBe(expectedProfile.reconciliation.accepted);
      expect(profile.reconciliation.rejected).toBe(expectedProfile.reconciliation.rejected);
      expect(profile.reconciliation.review).toBe(expectedProfile.reconciliation.review);
      expect(profile.reconciliation.skipped).toBe(expectedProfile.reconciliation.skipped);
      expect(profile.reconciliation.unaccounted).toBe(0);
      expect(profile.reconciliation.is_balanced).toBe(true);
    });

    it('matches expected distribution by record type', () => {
      expect(profile.by_record_type).toEqual(expectedProfile.by_record_type);
    });

    it('matches expected counts by reason code', () => {
      expect(profile.by_reason_code).toEqual(expectedProfile.by_reason_code);
    });

    it('validates complete profile report against contract schema', () => {
      const parsed = DirtyDataProfileReportSchema.parse(profile);
      expect(parsed.module).toBe('erp1');
      expect(parsed.reconciliation.is_balanced).toBe(true);
    });
  });

  describe('5. Domain Invariant Enforcement', () => {
    const rawRows = parseCsv(csvText);
    const evaluatedRows = evaluateDataset(rawRows);

    it('enforces BR-ERP1-01: SKU uniqueness after uppercase and trim normalization', () => {
      // PRD-017 is an exact duplicate of PRD-001 (FAST-BOLT-HEX-001)
      const exactDup = evaluatedRows.find((r) => r.source_id === 'PRD-017');
      expect(exactDup?.outcome).toBe('review');
      expect(exactDup?.reason_codes).toContain('DUPLICATE_SKU_REVIEW');

      // PRD-018 is a whitespace and lowercase variation (' fast-bolt-hex-001 ')
      const wsDup = evaluatedRows.find((r) => r.source_id === 'PRD-018');
      expect(wsDup?.outcome).toBe('review');
      expect(wsDup?.reason_codes).toContain('DUPLICATE_SKU_REVIEW');
    });

    it('enforces BR-ERP1-02: non-negative inventory stock quantity', () => {
      const negStock = evaluatedRows.find((r) => r.source_id === 'STK-018');
      expect(negStock?.outcome).toBe('rejected');
      expect(negStock?.reason_codes).toContain('NEGATIVE_STOCK');
    });

    it('enforces FR-ERP1-05 & BR-ERP1-03: single warehouse facility in V1', () => {
      // Primary warehouse WH-01 is accepted
      const primaryWh = evaluatedRows.find((r) => r.source_id === 'WH-001');
      expect(primaryWh?.outcome).toBe('accepted');

      // Secondary warehouse WH-02 is rejected
      const secondaryWh = evaluatedRows.find((r) => r.source_id === 'WH-002');
      expect(secondaryWh?.outcome).toBe('rejected');
      expect(secondaryWh?.reason_codes).toContain('MULTIPLE_WAREHOUSES_REJECTED');
    });

    it('enforces FR-ERP1-04: fixed units of measure', () => {
      const invGallons = evaluatedRows.find((r) => r.source_id === 'PRD-022');
      const invInches = evaluatedRows.find((r) => r.source_id === 'PRD-023');
      const invPallets = evaluatedRows.find((r) => r.source_id === 'PRD-024');

      expect(invGallons?.outcome).toBe('rejected');
      expect(invGallons?.reason_codes).toContain('INVALID_UNIT_OF_MEASURE');
      expect(invInches?.outcome).toBe('rejected');
      expect(invInches?.reason_codes).toContain('INVALID_UNIT_OF_MEASURE');
      expect(invPallets?.outcome).toBe('rejected');
      expect(invPallets?.reason_codes).toContain('INVALID_UNIT_OF_MEASURE');

      // Valid units accepted
      for (const uom of ACCEPTED_UOMS) {
        const matchingValidProduct = evaluatedRows.find(
          (r) => r.record_type === 'product' && r.outcome === 'accepted' && (r.normalized_data as RawRow).unit_of_measure === uom
        );
        expect(matchingValidProduct).toBeDefined();
      }
    });

    it('enforces FR-ERP1-02: non-negative price and explicit currency', () => {
      const negPrice = evaluatedRows.find((r) => r.source_id === 'PRD-026');
      expect(negPrice?.outcome).toBe('rejected');
      expect(negPrice?.reason_codes).toContain('NEGATIVE_PRICE');

      const noCur = evaluatedRows.find((r) => r.source_id === 'PRD-029');
      expect(noCur?.outcome).toBe('rejected');
      expect(noCur?.reason_codes).toContain('CURRENCY_REQUIRED');

      const invCur = evaluatedRows.find((r) => r.source_id === 'PRD-030');
      expect(invCur?.outcome).toBe('rejected');
      expect(invCur?.reason_codes).toContain('INVALID_CURRENCY');
    });
  });

  describe('6. Security, Injection Defense & Sensitive Masking', () => {
    const rawRows = parseCsv(csvText);
    const evaluatedRows = evaluateDataset(rawRows);

    it('detects and rejects formula injection attempts (PLT-12 / KIT-16)', () => {
      const cmdInj = evaluatedRows.find((r) => r.source_id === 'PRD-038');
      expect(cmdInj?.outcome).toBe('rejected');
      expect(cmdInj?.reason_codes).toContain('FORMULA_INJECTION_DETECTED');

      const plusInj = evaluatedRows.find((r) => r.source_id === 'PRD-039');
      expect(plusInj?.outcome).toBe('rejected');
      expect(plusInj?.reason_codes).toContain('FORMULA_INJECTION_DETECTED');
    });

    it('masks sensitive bank account and government ID numbers in review projections', () => {
      const sensitiveProduct = rawRows.find((r) => r.source_id === 'PRD-016');
      expect(sensitiveProduct).toBeDefined();
      expect(sensitiveProduct?.supplier_bank_account).toBe('CH93-0000-0000-0000-1234-5');
      expect(sensitiveProduct?.employee_ssn).toBe('999-00-1234');

      const masked = maskSensitiveFields(sensitiveProduct!);
      expect(masked.supplier_bank_account).toBe('****-****-34-5');
      expect(masked.employee_ssn).toBe('***-**-1234');
    });
  });

  describe('7. Contract Ingestion Validation', () => {
    const rawRows = parseCsv(csvText);
    const evaluatedRows = evaluateDataset(rawRows);
    const acceptedProducts = evaluatedRows.filter(
      (r) => r.record_type === 'product' && r.outcome === 'accepted'
    );

    it('verifies all accepted products validate against CreateProductInputSchema', () => {
      expect(acceptedProducts.length).toBeGreaterThanOrEqual(15);
      for (const row of acceptedProducts) {
        const raw = row.normalized_data as RawRow;
        const result = CreateProductInputSchema.safeParse({
          name: raw.name,
          sku: raw.sku,
          unitOfMeasure: raw.unit_of_measure,
          price: raw.price,
          currency: raw.currency,
          taxRate: raw.tax_rate || '0.00',
          notificationEmail: raw.notification_email || undefined,
          contactPhone: raw.contact_phone || undefined,
          sourceSystem: raw.source_system || undefined,
          sourceId: raw.source_id || undefined,
        });
        expect(result.success, `Product ${raw.source_id} failed schema validation`).toBe(true);
      }
    });
  });
});
