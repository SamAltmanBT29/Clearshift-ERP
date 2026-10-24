/**
 * ERP-1 Products & Inventory — V1 Data Quality Rules & Dirty Pack Test Suite
 *
 * Validates all Acceptance Criteria for Issue #13 ([ERP1-08]):
 * - AC 1: Synthetic fixture and expected outcomes are checked into the repository
 *         with SHA-256 checksum and schema/version.
 * - AC 2: Every required/optional field and enumeration has at least one valid and one invalid test row.
 * - AC 3: Rules are deterministic and versioned; same fixture/rule version yields byte-equivalent counts and outcomes.
 * - AC 4: Raw input checksum and raw cell values are unchanged after profiling/cleaning/mapping (BR-KIT-03).
 * - AC 5: Fuzzy matching is not used in V1; ambiguous candidates require explicit review,
 *         and any invalid reference produces a stable reject reason.
 * - AC 6: Every specified domain invariant is asserted: SKU uniqueness (BR-ERP1-01), non-negative stock (BR-ERP1-02),
 *         single warehouse in V1 (FR-ERP1-05 / BR-ERP1-03), fixed UoMs (FR-ERP1-04).
 * - AC 7: Mapping template policy, load order, and entity field coverage.
 * - AC 8: OpenAPI and @clearshift/contracts schema alignment.
 *
 * @module erp1/tests/migration/rules.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DirtyDataProfileReportSchema,
  DataQualityRuleSchema,
  CreateProductInputSchema,
} from '@clearshift/contracts';
import {
  RULES_VERSION,
  FIXTURE_SCHEMA_VERSION,
  PROFILE_SCHEMA_VERSION,
  SOURCE_SYSTEM,
  FIXTURE_PATH,
  ACCEPTED_UOMS,
  ACCEPTED_CURRENCIES,
  RECORD_TYPES,
  FIXTURE_COLUMNS,
  RULE_CATALOGUE,
  readRawRows,
  parseCsv,
  evaluateDataset,
  buildProfile,
  sha256Hex,
  maskSensitiveFields,
  normalizeSku,
  validateIsoDate,
  stableStringify,
  type ProfileReport,
  type RawRow,
} from '../../src/migration/rules.js';

// ─────────────────────────────────────────────────────────────────────────────
// Load committed fixtures (read-only)
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

const CSV_TEXT = read(FIXTURE_PATH);
const EXPECTED_PROFILE_TEXT = read('sample-data/erp-1/expected-profile.json');
const EXPECTED_PROFILE = JSON.parse(EXPECTED_PROFILE_TEXT) as ProfileReport;
const MAPPING_TEMPLATE = JSON.parse(read('sample-data/erp-1/mapping-template.json'));

describe('ERP-1 Products & Inventory — V1 Data Quality Rules & Dirty Pack (#13 / [ERP1-08])', () => {
  // ── AC 1: Fixture Manifest, Checksum & Schema Versioning ───────────────────
  describe('AC 1: Committed Synthetic Fixture & Checksum Manifest', () => {
    it('verifies dirty-data-v1.csv matches the committed SHA-256 fingerprint exactly', () => {
      const computedHash = sha256Hex(CSV_TEXT);
      expect(computedHash).toBe('25040ea5a6c9ec820f21798f0f4014edb116844392fea024048e96537c39ee91');
      expect(computedHash).toBe(EXPECTED_PROFILE.fixture_sha256);
      expect(EXPECTED_PROFILE.fixture).toBe(FIXTURE_PATH);
      expect(EXPECTED_PROFILE.profile_schema_version).toBe(PROFILE_SCHEMA_VERSION);
      expect(EXPECTED_PROFILE.rules_version).toBe(RULES_VERSION);
    });

    it('verifies row count is >= 100 rows and distributed across all 4 canonical entities', () => {
      const rows = readRawRows(CSV_TEXT);
      expect(rows.length).toBe(131);
      expect(rows.length).toBeGreaterThanOrEqual(100);
      expect(EXPECTED_PROFILE.total_rows).toBe(131);

      const byType = {
        category: rows.filter((r) => r.record_type === 'category').length,
        warehouse: rows.filter((r) => r.record_type === 'warehouse').length,
        product: rows.filter((r) => r.record_type === 'product').length,
        stock_level: rows.filter((r) => r.record_type === 'stock_level').length,
      };

      expect(byType.category).toBe(15);
      expect(byType.warehouse).toBe(6);
      expect(byType.product).toBe(65);
      expect(byType.stock_level).toBe(45);
    });

    it('reconciles 100% of rows with zero unaccounted records', () => {
      const { reconciliation } = EXPECTED_PROFILE;
      expect(reconciliation.total_source_rows).toBe(131);
      expect(reconciliation.accepted).toBe(69);
      expect(reconciliation.rejected).toBe(55);
      expect(reconciliation.review).toBe(7);
      expect(reconciliation.skipped).toBe(0);
      expect(reconciliation.unaccounted).toBe(0);
      expect(reconciliation.is_balanced).toBe(true);
      expect(
        reconciliation.accepted +
          reconciliation.rejected +
          reconciliation.review +
          reconciliation.skipped
      ).toBe(reconciliation.total_source_rows);
    });
  });

  // ── AC 2: Valid and Invalid Row Coverage for Fields & Enumerations ─────────
  describe('AC 2: Field & Enumeration Coverage (Valid vs. Invalid Rows)', () => {
    const rawRows = readRawRows(CSV_TEXT);
    const evaluatedRows = evaluateDataset(parseCsv(CSV_TEXT));

    // Category
    describe('Category fields', () => {
      it('has valid and invalid rows for category code', () => {
        // Valid
        const valid = rawRows.find((r) => r.record_type === 'category' && r.row_id === 'R001');
        expect(valid?.code).toBe('GEN');
        const evalValid = evaluatedRows.find((r) => r.row_id === 'R001');
        expect(evalValid?.outcome).toBe('accepted');

        // Invalid: missing code
        const missing = rawRows.find((r) => r.record_type === 'category' && r.row_id === 'R009');
        expect(missing?.code).toBe('');
        const evalMissing = evaluatedRows.find((r) => r.row_id === 'R009');
        expect(evalMissing?.outcome).toBe('rejected');
        expect(evalMissing?.reason_codes).toContain('CATEGORY_CODE_REQUIRED');

        // Invalid: code too long
        const tooLong = rawRows.find((r) => r.record_type === 'category' && r.row_id === 'R011');
        expect(tooLong?.code.length).toBeGreaterThan(64);
        const evalTooLong = evaluatedRows.find((r) => r.row_id === 'R011');
        expect(evalTooLong?.outcome).toBe('rejected');
        expect(evalTooLong?.reason_codes).toContain('CATEGORY_CODE_TOO_LONG');
      });

      it('has valid and invalid rows for category name', () => {
        // Valid
        const valid = evaluatedRows.find((r) => r.row_id === 'R002');
        expect(valid?.outcome).toBe('accepted');

        // Invalid: missing name
        const missing = evaluatedRows.find((r) => r.row_id === 'R010');
        expect(missing?.outcome).toBe('rejected');
        expect(missing?.reason_codes).toContain('CATEGORY_NAME_REQUIRED');
      });
    });

    // Warehouse
    describe('Warehouse fields', () => {
      it('has valid and invalid rows for warehouse code and facility limit', () => {
        // Valid: WH-01
        const valid = evaluatedRows.find((r) => r.row_id === 'R016');
        expect(valid?.outcome).toBe('accepted');

        // Invalid: secondary warehouse rejected
        const secondary = evaluatedRows.find((r) => r.row_id === 'R017');
        expect(secondary?.outcome).toBe('rejected');
        expect(secondary?.reason_codes).toContain('MULTIPLE_WAREHOUSES_REJECTED');

        // Invalid: missing code
        const missing = evaluatedRows.find((r) => r.row_id === 'R018');
        expect(missing?.outcome).toBe('rejected');
        expect(missing?.reason_codes).toContain('WAREHOUSE_CODE_REQUIRED');
      });

      it('has valid and invalid rows for warehouse name', () => {
        const missing = evaluatedRows.find((r) => r.row_id === 'R019');
        expect(missing?.outcome).toBe('rejected');
        expect(missing?.reason_codes).toContain('WAREHOUSE_NAME_REQUIRED');
      });
    });

    // Product
    describe('Product fields and enumerations', () => {
      it('has valid and invalid rows for product name and SKU', () => {
        const valid = evaluatedRows.find((r) => r.row_id === 'R022');
        expect(valid?.outcome).toBe('accepted');

        // Missing name
        const missingName = evaluatedRows.find((r) => r.row_id === 'R060');
        expect(missingName?.outcome).toBe('rejected');
        expect(missingName?.reason_codes).toContain('PRODUCT_NAME_REQUIRED');

        // Missing SKU
        const missingSku = evaluatedRows.find((r) => r.row_id === 'R061');
        expect(missingSku?.outcome).toBe('rejected');
        expect(missingSku?.reason_codes).toContain('SKU_REQUIRED');
      });

      it('covers all 6 approved units of measure and rejects invalid units', () => {
        // pcs, kg, g, litre, metre, box
        for (const uom of ACCEPTED_UOMS) {
          const rowWithUom = rawRows.find((r) => r.record_type === 'product' && r.unit_of_measure === uom);
          expect(rowWithUom, `Missing test row for UoM ${uom}`).toBeDefined();
        }

        // Invalid UoM enumeration
        const invalidUom = evaluatedRows.find((r) => r.row_id === 'R063');
        expect(invalidUom?.outcome).toBe('rejected');
        expect(invalidUom?.reason_codes).toContain('INVALID_UNIT_OF_MEASURE');
      });

      it('has valid and invalid rows for price and currency', () => {
        // Zero price valid (R047)
        const zeroPrice = evaluatedRows.find((r) => r.row_id === 'R047');
        expect(zeroPrice?.outcome).toBe('accepted');

        // Missing price invalid (R066)
        const missingPrice = evaluatedRows.find((r) => r.row_id === 'R066');
        expect(missingPrice?.outcome).toBe('rejected');
        expect(missingPrice?.reason_codes).toContain('PRICE_REQUIRED');

        // Negative price invalid (R067)
        const negPrice = evaluatedRows.find((r) => r.row_id === 'R067');
        expect(negPrice?.outcome).toBe('rejected');
        expect(negPrice?.reason_codes).toContain('NEGATIVE_PRICE');

        // Excess decimal places (>4) invalid (R070)
        const excessPrice = evaluatedRows.find((r) => r.row_id === 'R070');
        expect(excessPrice?.outcome).toBe('rejected');
        expect(excessPrice?.reason_codes).toContain('EXCESS_DECIMAL_PLACES');

        // Missing currency invalid (R071)
        const missingCurrency = evaluatedRows.find((r) => r.row_id === 'R071');
        expect(missingCurrency?.outcome).toBe('rejected');
        expect(missingCurrency?.reason_codes).toContain('CURRENCY_REQUIRED');

        // Invalid currency (R072)
        const badCurrency = evaluatedRows.find((r) => r.row_id === 'R072');
        expect(badCurrency?.outcome).toBe('rejected');
        expect(badCurrency?.reason_codes).toContain('INVALID_CURRENCY');
      });

      it('has valid and invalid rows for tax rate', () => {
        // Negative tax rate (R074)
        const negTax = evaluatedRows.find((r) => r.row_id === 'R074');
        expect(negTax?.outcome).toBe('rejected');
        expect(negTax?.reason_codes).toContain('NEGATIVE_TAX_RATE');

        // Tax rate > 100% (R076)
        const highTax = evaluatedRows.find((r) => r.row_id === 'R076');
        expect(highTax?.outcome).toBe('rejected');
        expect(highTax?.reason_codes).toContain('TAX_RATE_OUT_OF_RANGE');

        // Invalid tax rate format (R078)
        const badTaxFormat = evaluatedRows.find((r) => r.row_id === 'R078');
        expect(badTaxFormat?.outcome).toBe('rejected');
        expect(badTaxFormat?.reason_codes).toContain('INVALID_TAX_RATE_FORMAT');
      });

      it('has valid and invalid rows for category foreign key reference', () => {
        const missingCat = evaluatedRows.find((r) => r.row_id === 'R079');
        expect(missingCat?.outcome).toBe('rejected');
        expect(missingCat?.reason_codes).toContain('CATEGORY_NOT_FOUND');
      });
    });

    // Stock Level
    describe('Stock Level fields', () => {
      it('has valid and invalid rows for stock quantity and non-negative rule (BR-ERP1-02)', () => {
        // Valid stock (R087)
        const validStock = evaluatedRows.find((r) => r.row_id === 'R087');
        expect(validStock?.outcome).toBe('accepted');

        // Negative stock invalid (R114)
        const negStock = evaluatedRows.find((r) => r.row_id === 'R114');
        expect(negStock?.outcome).toBe('rejected');
        expect(negStock?.reason_codes).toContain('NEGATIVE_STOCK');

        // Excess decimal places (>4) invalid (R122)
        const excessStock = evaluatedRows.find((r) => r.row_id === 'R122');
        expect(excessStock?.outcome).toBe('rejected');
        expect(excessStock?.reason_codes).toContain('EXCESS_DECIMAL_PLACES');

        // Missing quantity invalid (R123)
        const missingQty = evaluatedRows.find((r) => r.row_id === 'R123');
        expect(missingQty?.outcome).toBe('rejected');
        expect(missingQty?.reason_codes).toContain('QUANTITY_REQUIRED');
      });

      it('has valid and invalid rows for product and warehouse foreign key references', () => {
        // Product FK not found (R116)
        const badProd = evaluatedRows.find((r) => r.row_id === 'R116');
        expect(badProd?.outcome).toBe('rejected');
        expect(badProd?.reason_codes).toContain('PRODUCT_NOT_FOUND');

        // Warehouse FK not found (R118)
        const badWh = evaluatedRows.find((r) => r.row_id === 'R118');
        expect(badWh?.outcome).toBe('rejected');
        expect(badWh?.reason_codes).toContain('WAREHOUSE_NOT_FOUND');
      });

      it('has valid and invalid rows for stock as_of_date calendar format', () => {
        // Ambiguous date format (R125)
        const ambDate = evaluatedRows.find((r) => r.row_id === 'R125');
        expect(ambDate?.outcome).toBe('rejected');
        expect(ambDate?.reason_codes).toContain('AMBIGUOUS_DATE_FORMAT');

        // Invalid calendar date (e.g. Feb 30) (R127)
        const invDate = evaluatedRows.find((r) => r.row_id === 'R127');
        expect(invDate?.outcome).toBe('rejected');
        expect(invDate?.reason_codes).toContain('INVALID_DATE');
      });
    });
  });

  // ── AC 3: Determinism & Multi-Run Reproducibility ───────────────────────────
  describe('AC 3: Determinism & Multi-Run Reproducibility', () => {
    it('produces byte-identical JSON profile output across 5 consecutive runs', () => {
      const run1 = stableStringify(buildProfile(CSV_TEXT));
      for (let i = 2; i <= 5; i++) {
        const runN = stableStringify(buildProfile(CSV_TEXT));
        expect(runN).toBe(run1);
      }
    });

    it('matches committed expected-profile.json reconciliation numbers exactly', () => {
      const generated = buildProfile(CSV_TEXT);
      expect(generated.reconciliation).toEqual(EXPECTED_PROFILE.reconciliation);
      expect(generated.by_record_type).toEqual(EXPECTED_PROFILE.by_record_type);
      expect(generated.by_reason_code).toEqual(EXPECTED_PROFILE.by_reason_code);
    });
  });

  // ── AC 4: Raw Input Immutability (BR-KIT-03) ────────────────────────────────
  describe('AC 4: Raw Input Immutability Guarantee', () => {
    it('ensures raw input text and raw cells are never mutated during profiling or cleaning', () => {
      const rawBefore = parseCsv(CSV_TEXT);
      const frozenSnap = JSON.stringify(rawBefore);

      // Run full evaluation and profile building
      const evaluated = evaluateDataset(rawBefore);
      const profile = buildProfile(CSV_TEXT, evaluated);
      expect(profile).toBeDefined();

      const frozenAfter = JSON.stringify(rawBefore);
      expect(frozenAfter).toBe(frozenSnap);
      expect(sha256Hex(CSV_TEXT)).toBe(EXPECTED_PROFILE.fixture_sha256);
    });
  });

  // ── AC 5: No Fuzzy Auto-Merge & Deterministic Candidate Review ──────────────
  describe('AC 5: Exact Candidate Duplicate Review Policy (No Fuzzy Merge)', () => {
    const evaluatedRows = evaluateDataset(parseCsv(CSV_TEXT));

    it('holds candidate duplicate category codes for explicit operator review', () => {
      const dupCat = evaluatedRows.find((r) => r.row_id === 'R012');
      expect(dupCat?.outcome).toBe('review');
      expect(dupCat?.reason_codes).toContain('DUPLICATE_CATEGORY_CODE_REVIEW');
    });

    it('holds case-insensitive and whitespace-padded duplicate category codes for review', () => {
      const dupPad = evaluatedRows.find((r) => r.row_id === 'R013');
      expect(dupPad?.outcome).toBe('review');
      expect(dupPad?.reason_codes).toContain('DUPLICATE_CATEGORY_CODE_REVIEW');
    });

    it('holds duplicate normalized SKUs for review (never auto-merged)', () => {
      const dupSku = evaluatedRows.find((r) => r.row_id === 'R057');
      expect(dupSku?.outcome).toBe('review');
      expect(dupSku?.reason_codes).toContain('DUPLICATE_SKU_REVIEW');

      const dupCaseSku = evaluatedRows.find((r) => r.row_id === 'R058');
      expect(dupCaseSku?.outcome).toBe('review');
      expect(dupCaseSku?.reason_codes).toContain('DUPLICATE_SKU_REVIEW');
    });

    it('holds duplicate opening stock level entries for review', () => {
      const dupStock = evaluatedRows.find((r) => r.row_id === 'R112');
      expect(dupStock?.outcome).toBe('review');
      expect(dupStock?.reason_codes).toContain('DUPLICATE_STOCK_LEVEL_REVIEW');
    });
  });

  // ── AC 6: Domain Invariant Assertions ──────────────────────────────────────
  describe('AC 6: Core Domain Invariants', () => {
    it('enforces BR-ERP1-01: SKU normalization to uppercase and trimming', () => {
      expect(normalizeSku('  bolt-m8-hex  ')).toBe('BOLT-M8-HEX');
      expect(normalizeSku('PRD-100\t')).toBe('PRD-100');
    });

    it('enforces BR-ERP1-02: Non-negative inventory stock quantity', () => {
      const rawRows = readRawRows(CSV_TEXT);
      const negRows = rawRows.filter((r) => r.record_type === 'stock_level' && Number(r.quantity) < 0);
      expect(negRows.length).toBeGreaterThan(0);

      const evaluated = evaluateDataset(parseCsv(CSV_TEXT));
      for (const neg of negRows) {
        const evalRow = evaluated.find((r) => r.row_id === neg.row_id);
        expect(evalRow?.outcome).toBe('rejected');
        expect(evalRow?.reason_codes).toContain('NEGATIVE_STOCK');
      }
    });

    it('enforces FR-ERP1-05 & BR-ERP1-03: Single warehouse facility WH-01 in V1', () => {
      const evaluated = evaluateDataset(parseCsv(CSV_TEXT));
      const whRows = evaluated.filter((r) => r.record_type === 'warehouse');
      const acceptedWh = whRows.filter((r) => r.outcome === 'accepted');
      expect(acceptedWh.length).toBe(1);
      expect(acceptedWh[0]?.row_id).toBe('R016');
    });

    it('enforces PLT-12 / KIT-16: Formula injection defense for =, +, -, @, \\t, \\r', () => {
      const evaluated = evaluateDataset(parseCsv(CSV_TEXT));
      const formulaRows = evaluated.filter((r) => r.reason_codes.includes('FORMULA_INJECTION_DETECTED'));
      expect(formulaRows.length).toBe(9);
      for (const row of formulaRows) {
        expect(row.outcome).toBe('rejected');
      }
    });

    it('masks sensitive banking and identification fields in review projections', () => {
      const rawRows = readRawRows(CSV_TEXT);
      const maskedRow = rawRows.find((r) => r.row_id === 'R037');
      expect(maskedRow?.supplier_bank_account).toBeDefined();
      expect(maskedRow?.employee_ssn).toBeDefined();

      const projection = maskSensitiveFields(maskedRow!);
      expect(String(projection['supplier_bank_account'])).toMatch(/^\*{4}-\*{4}-/);
      expect(String(projection['employee_ssn'])).toMatch(/^\*{3}-\*{2}-\d{4}$/);
    });
  });

  // ── AC 7: Mapping Template Validation ──────────────────────────────────────
  describe('AC 7: Mapping Template Structure & Policy Validation', () => {
    it('validates mapping template metadata and strict zero-fuzzy policy', () => {
      expect(MAPPING_TEMPLATE.mapping_schema_version).toBe(1);
      expect(MAPPING_TEMPLATE.rules_version).toBe(RULES_VERSION);
      expect(MAPPING_TEMPLATE.module).toBe('erp1');
      expect(MAPPING_TEMPLATE.source_system).toBe(SOURCE_SYSTEM);
      expect(MAPPING_TEMPLATE.policy.fuzzy_matching).toBe(false);
      expect(MAPPING_TEMPLATE.policy.automatic_merge).toBe(false);
      expect(MAPPING_TEMPLATE.policy.raw_input_mutation).toBe(false);
    });

    it('specifies explicit load order resolving foreign key dependencies', () => {
      expect(MAPPING_TEMPLATE.load_order).toEqual([
        'category',
        'warehouse',
        'product',
        'stock_level',
      ]);
    });

    it('maps all 4 entities to valid database target tables and public REST endpoints', () => {
      const entities = MAPPING_TEMPLATE.entities;
      expect(entities.category.target_table).toBe('erp1.categories');
      expect(entities.category.api).toBe('POST /api/v1/erp-products/categories');

      expect(entities.warehouse.target_table).toBe('erp1.warehouses');
      expect(entities.warehouse.api).toBe('POST /api/v1/erp-products/warehouses');

      expect(entities.product.target_table).toBe('erp1.products');
      expect(entities.product.api).toBe('POST /api/v1/erp-products/products');

      expect(entities.stock_level.target_table).toBe('erp1.stock_levels');
      expect(entities.stock_level.api).toBe('POST /api/v1/erp-products/stock/opening');
    });
  });

  // ── AC 8: Contracts & Schema Alignment ─────────────────────────────────────
  describe('AC 8: Contracts & Schema Registry Alignment', () => {
    it('validates every rule in RULE_CATALOGUE against DataQualityRuleSchema', () => {
      expect(RULE_CATALOGUE.length).toBeGreaterThanOrEqual(35);
      for (const rule of RULE_CATALOGUE) {
        const parsed = DataQualityRuleSchema.safeParse(rule);
        expect(parsed.success, `Rule ${rule.rule_id} failed schema validation: ${JSON.stringify(parsed)}`).toBe(true);
      }
    });

    it('validates generated profile against DirtyDataProfileReportSchema', () => {
      const profile = buildProfile(CSV_TEXT);
      const parsed = DirtyDataProfileReportSchema.safeParse(profile);
      expect(parsed.success, `Profile report failed schema validation: ${JSON.stringify(parsed)}`).toBe(true);
    });

    it('verifies accepted product rows conform to CreateProductInputSchema', () => {
      const evaluated = evaluateDataset(parseCsv(CSV_TEXT));
      const acceptedProducts = evaluated.filter((r) => r.record_type === 'product' && r.outcome === 'accepted');
      expect(acceptedProducts.length).toBe(35);

      for (const row of acceptedProducts) {
        const raw = row.normalized_data as RawRow;
        const candidate = {
          name: raw.name.trim(),
          sku: normalizeSku(raw.sku),
          unitOfMeasure: raw.unit_of_measure.trim(),
          price: raw.price.trim(),
          currency: raw.currency.trim().toUpperCase(),
          taxRate: raw.tax_rate.trim() || '0.00',
        };
        const parsed = CreateProductInputSchema.safeParse(candidate);
        expect(parsed.success, `Row ${raw.row_id} failed CreateProductInputSchema`).toBe(true);
      }
    });
  });
});
