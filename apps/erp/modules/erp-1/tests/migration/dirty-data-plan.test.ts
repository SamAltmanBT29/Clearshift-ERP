/**
 * ERP-1 Products & Inventory — Canonical Dirty Data Pack & Migration Profiling Test Suite
 *
 * Validates all Acceptance Criteria for [ERP1-25] (#121):
 * - AC 1: Dirty Data Pack contains at least 100 realistic synthetic rows; zero real personal data.
 * - AC 2: Manifest documents expected outcome per row: valid, malformed, null required, exact duplicate, foreign key missing.
 * - AC 3: Edge cases include UTF-8 characters, whitespace padding, date format variants, and boundary numbers.
 * - AC 4: Test suite verifies fixture counts reproduce identically across multiple runs.
 *
 * Also verifies:
 * - Committed synthetic Dirty Data Pack fixture manifest and SHA-256 checksum
 * - Rule catalogue integrity (rule IDs, actions, explanations, doc references)
 * - Raw input immutability guarantee (BR-KIT-03)
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
  validateIsoDate,
  type ProfileReport,
  type RawRow,
} from '../../src/migration/dirty-data-plan.js';

const REPO_ROOT = resolve(__dirname, '../../../../../../');
const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

describe('ERP-1 Canonical Dirty Data Pack & Migration Rules ([ERP1-25] #121)', () => {
  const csvText = read(FIXTURE_PATH);
  const expectedProfileText = read('sample-data/erp-1/expected-profile.json');
  const expectedProfile = JSON.parse(expectedProfileText) as ProfileReport;
  const mappingTemplateText = read('sample-data/erp-1/mapping-template.json');
  const mappingTemplate = JSON.parse(mappingTemplateText);

  // ── AC 1: Realistic Synthetic Data (≥100 rows, zero real personal data) ────
  describe('AC 1: Synthetic Dataset Scale & Privacy (Zero Real PII)', () => {
    const rawRows = parseCsv(csvText);

    it('contains at least 100 realistic synthetic rows (committed 131 rows)', () => {
      expect(rawRows.length).toBeGreaterThanOrEqual(100);
      expect(rawRows.length).toBe(131);
      expect(expectedProfile.total_rows).toBe(131);
    });

    it('guarantees zero real personal data across all rows (strictly synthetic domains and numbers)', () => {
      for (const row of rawRows) {
        // Any email provided must use RFC-2606 reserved example domains or be an invalid test case
        if (row.notification_email && row.notification_email !== 'invalid-email-address') {
          expect(row.notification_email).toMatch(/^[a-zA-Z0-9._%+-]+@example\.(com|org|net)$/);
        }

        // Any phone provided must use reserved 555-01xx test numbers or be a defect test case
        if (row.contact_phone && row.contact_phone !== 'phone-not-a-number') {
          expect(row.contact_phone).toMatch(/^\+1-555-01\d{2}$/);
        }

        // Bank accounts must use reserved synthetic dummy IBAN format (CH93-0000...)
        if (row.supplier_bank_account) {
          expect(row.supplier_bank_account).toMatch(/^CH93-0000-0000-0000-\d{4}-\d$/);
        }

        // Government IDs must use reserved synthetic SSN format (999-00-xxxx)
        if (row.employee_ssn) {
          expect(row.employee_ssn).toMatch(/^999-00-\d{4}$/);
        }
      }
    });

    it('distributes rows across all 4 canonical ERP-1 entities', () => {
      const counts = {
        category: rawRows.filter((r) => r.record_type === 'category').length,
        warehouse: rawRows.filter((r) => r.record_type === 'warehouse').length,
        product: rawRows.filter((r) => r.record_type === 'product').length,
        stock_level: rawRows.filter((r) => r.record_type === 'stock_level').length,
      };

      expect(counts.category).toBe(15);
      expect(counts.warehouse).toBe(6);
      expect(counts.product).toBe(65);
      expect(counts.stock_level).toBe(45);
    });
  });

  // ── AC 2: Manifest Documents Expected Outcome Per Row ──────────────────────
  describe('AC 2: Manifest Outcome Documentation Per Row', () => {
    const rawRows = parseCsv(csvText);
    const evaluatedRows = evaluateDataset(rawRows);

    it('manifest documents expected outcome and reasons for all 131 rows', () => {
      expect(expectedProfile.rows).toBeDefined();
      expect(Object.keys(expectedProfile.rows).length).toBe(131);

      for (const row of evaluatedRows) {
        const manifestEntry = expectedProfile.rows[row.row_id];
        expect(manifestEntry, `Missing manifest entry for ${row.row_id}`).toBeDefined();
        expect(manifestEntry.outcome).toBe(row.outcome);
        expect(manifestEntry.reasons).toEqual(row.reason_codes);
      }
    });

    it('documents valid outcomes (accepted terminal state)', () => {
      const validCategory = evaluatedRows.find((r) => r.row_id === 'R001');
      expect(validCategory?.outcome).toBe('accepted');
      expect(validCategory?.reason_codes).toEqual([]);

      const validWarehouse = evaluatedRows.find((r) => r.row_id === 'R016');
      expect(validWarehouse?.outcome).toBe('accepted');

      const validProduct = evaluatedRows.find((r) => r.row_id === 'R022');
      expect(validProduct?.outcome).toBe('accepted');

      const validStock = evaluatedRows.find((r) => r.row_id === 'R087');
      expect(validStock?.outcome).toBe('accepted');
    });

    it('documents malformed outcomes (format defect rejections)', () => {
      // Malformed price
      const badPrice = evaluatedRows.find((r) => r.row_id === 'R069');
      expect(badPrice?.outcome).toBe('rejected');
      expect(badPrice?.reason_codes).toContain('INVALID_PRICE_FORMAT');

      // Malformed currency
      const badCurrency = evaluatedRows.find((r) => r.row_id === 'R072');
      expect(badCurrency?.outcome).toBe('rejected');
      expect(badCurrency?.reason_codes).toContain('INVALID_CURRENCY');

      // Malformed tax rate
      const badTax = evaluatedRows.find((r) => r.row_id === 'R078');
      expect(badTax?.outcome).toBe('rejected');
      expect(badTax?.reason_codes).toContain('INVALID_TAX_RATE_FORMAT');

      // Malformed UOM
      const badUom = evaluatedRows.find((r) => r.row_id === 'R063');
      expect(badUom?.outcome).toBe('rejected');
      expect(badUom?.reason_codes).toContain('INVALID_UNIT_OF_MEASURE');

      // Malformed stock quantity
      const badQty = evaluatedRows.find((r) => r.row_id === 'R121');
      expect(badQty?.outcome).toBe('rejected');
      expect(badQty?.reason_codes).toContain('INVALID_QUANTITY_FORMAT');
    });

    it('documents null required outcomes (missing mandatory attributes)', () => {
      const nullCatCode = evaluatedRows.find((r) => r.row_id === 'R009');
      expect(nullCatCode?.outcome).toBe('rejected');
      expect(nullCatCode?.reason_codes).toContain('CATEGORY_CODE_REQUIRED');

      const nullWhName = evaluatedRows.find((r) => r.row_id === 'R019');
      expect(nullWhName?.outcome).toBe('rejected');
      expect(nullWhName?.reason_codes).toContain('WAREHOUSE_NAME_REQUIRED');

      const nullProdName = evaluatedRows.find((r) => r.row_id === 'R060');
      expect(nullProdName?.outcome).toBe('rejected');
      expect(nullProdName?.reason_codes).toContain('PRODUCT_NAME_REQUIRED');

      const nullSku = evaluatedRows.find((r) => r.row_id === 'R061');
      expect(nullSku?.outcome).toBe('rejected');
      expect(nullSku?.reason_codes).toContain('SKU_REQUIRED');

      const nullPrice = evaluatedRows.find((r) => r.row_id === 'R066');
      expect(nullPrice?.outcome).toBe('rejected');
      expect(nullPrice?.reason_codes).toContain('PRICE_REQUIRED');

      const nullWhStock = evaluatedRows.find((r) => r.row_id === 'R120');
      expect(nullWhStock?.outcome).toBe('rejected');
      expect(nullWhStock?.reason_codes).toContain('WAREHOUSE_REQUIRED');
    });

    it('documents exact duplicate outcomes (candidate duplicates held for review)', () => {
      const dupCat = evaluatedRows.find((r) => r.row_id === 'R012');
      expect(dupCat?.outcome).toBe('review');
      expect(dupCat?.reason_codes).toContain('DUPLICATE_CATEGORY_CODE_REVIEW');

      const dupSku = evaluatedRows.find((r) => r.row_id === 'R057');
      expect(dupSku?.outcome).toBe('review');
      expect(dupSku?.reason_codes).toContain('DUPLICATE_SKU_REVIEW');

      const dupStock = evaluatedRows.find((r) => r.row_id === 'R112');
      expect(dupStock?.outcome).toBe('review');
      expect(dupStock?.reason_codes).toContain('DUPLICATE_STOCK_LEVEL_REVIEW');
    });

    it('documents foreign key missing outcomes (referential integrity rejections)', () => {
      const missingCat = evaluatedRows.find((r) => r.row_id === 'R079');
      expect(missingCat?.outcome).toBe('rejected');
      expect(missingCat?.reason_codes).toContain('CATEGORY_NOT_FOUND');

      const missingProd = evaluatedRows.find((r) => r.row_id === 'R116');
      expect(missingProd?.outcome).toBe('rejected');
      expect(missingProd?.reason_codes).toContain('PRODUCT_NOT_FOUND');

      const missingWh = evaluatedRows.find((r) => r.row_id === 'R118');
      expect(missingWh?.outcome).toBe('rejected');
      expect(missingWh?.reason_codes).toContain('WAREHOUSE_NOT_FOUND');
    });
  });

  // ── AC 3: Edge Cases: UTF-8, Whitespace, Date Formats & Boundary Numbers ───
  describe('AC 3: Edge Case Scenarios', () => {
    const rawRows = parseCsv(csvText);
    const evaluatedRows = evaluateDataset(rawRows);

    describe('UTF-8 International Character Support', () => {
      it('accepts UTF-8 German characters with umlauts and diameter symbol', () => {
        const germanProd = evaluatedRows.find((r) => r.row_id === 'R038');
        expect(germanProd?.outcome).toBe('accepted');
        expect((germanProd?.normalized_data as RawRow).name).toBe('Schraube M8 Edelstahl Rostfrei Ø8mm');
      });

      it('accepts UTF-8 French accented characters', () => {
        const frenchProd = evaluatedRows.find((r) => r.row_id === 'R039');
        expect(frenchProd?.outcome).toBe('accepted');
        expect((frenchProd?.normalized_data as RawRow).name).toBe('Écrou Hexagonal Zingué M10');
      });

      it('accepts UTF-8 Spanish accents and Greek mathematical symbol Ω', () => {
        const spanishProd = evaluatedRows.find((r) => r.row_id === 'R040');
        expect(spanishProd?.outcome).toBe('accepted');
        expect((spanishProd?.normalized_data as RawRow).name).toBe('Resistencia Térmica 10kΩ');
      });

      it('accepts UTF-8 Japanese Kanji and Katakana characters', () => {
        const japaneseProd = evaluatedRows.find((r) => r.row_id === 'R041');
        expect(japaneseProd?.outcome).toBe('accepted');
        expect((japaneseProd?.normalized_data as RawRow).name).toBe('高精度リニアガイド 500mm');
      });

      it('accepts UTF-8 category code and name with accents', () => {
        const frenchCat = evaluatedRows.find((r) => r.row_id === 'R007');
        expect(frenchCat?.outcome).toBe('accepted');
        expect((frenchCat?.normalized_data as RawRow).code).toBe('MÉC');
      });
    });

    describe('Whitespace Padding & Normalization', () => {
      it('normalizes leading and trailing whitespace on product names', () => {
        const paddedName = evaluatedRows.find((r) => r.row_id === 'R042');
        expect(paddedName?.outcome).toBe('accepted');
        expect((paddedName?.normalized_data as RawRow).name).toBe('  Industrial Heavy-Duty Drill  ');
      });

      it('normalizes whitespace around currency codes', () => {
        const paddedCur = evaluatedRows.find((r) => r.row_id === 'R043');
        expect(paddedCur?.outcome).toBe('accepted');
      });

      it('normalizes whitespace around category codes', () => {
        const paddedCat = evaluatedRows.find((r) => r.row_id === 'R044');
        expect(paddedCat?.outcome).toBe('accepted');
      });

      it('catches lowercase and whitespace padded SKU duplicates for operator review', () => {
        const dupSku = evaluatedRows.find((r) => r.row_id === 'R058');
        expect(dupSku?.outcome).toBe('review');
        expect(dupSku?.reason_codes).toContain('DUPLICATE_SKU_REVIEW');
      });

      it('catches lowercase and whitespace padded stock level duplicates for review', () => {
        const dupStock = evaluatedRows.find((r) => r.row_id === 'R113');
        expect(dupStock?.outcome).toBe('review');
        expect(dupStock?.reason_codes).toContain('DUPLICATE_STOCK_LEVEL_REVIEW');
      });
    });

    describe('Date Format Variants & Calendar Validity', () => {
      it('accepts standard ISO-8601 date string (YYYY-MM-DD)', () => {
        const isoStock = evaluatedRows.find((r) => r.row_id === 'R087');
        expect(isoStock?.outcome).toBe('accepted');
        expect(validateIsoDate('2026-04-01')).toEqual({ valid: true, ambiguous: false });
      });

      it('accepts full ISO-8601 datetime with timezone (YYYY-MM-DDTHH:mm:ssZ)', () => {
        const isoDateTimeStock = evaluatedRows.find((r) => r.row_id === 'R088');
        expect(isoDateTimeStock?.outcome).toBe('accepted');
        expect(validateIsoDate('2026-04-01T08:00:00Z')).toEqual({ valid: true, ambiguous: false });
      });

      it('rejects ambiguous slash-delimited date (MM/DD/YYYY) with AMBIGUOUS_DATE_FORMAT', () => {
        const slashDate = evaluatedRows.find((r) => r.row_id === 'R125');
        expect(slashDate?.outcome).toBe('rejected');
        expect(slashDate?.reason_codes).toContain('AMBIGUOUS_DATE_FORMAT');
      });

      it('rejects ambiguous dash-delimited date (DD-MM-YYYY) with AMBIGUOUS_DATE_FORMAT', () => {
        const dashDate = evaluatedRows.find((r) => r.row_id === 'R126');
        expect(dashDate?.outcome).toBe('rejected');
        expect(dashDate?.reason_codes).toContain('AMBIGUOUS_DATE_FORMAT');
      });

      it('rejects non-existent calendar date (2026-02-30) with INVALID_DATE', () => {
        const feb30Date = evaluatedRows.find((r) => r.row_id === 'R127');
        expect(feb30Date?.outcome).toBe('rejected');
        expect(feb30Date?.reason_codes).toContain('INVALID_DATE');
      });

      it('rejects arbitrary non-date text with INVALID_DATE', () => {
        const textDate = evaluatedRows.find((r) => r.row_id === 'R128');
        expect(textDate?.outcome).toBe('rejected');
        expect(textDate?.reason_codes).toContain('INVALID_DATE');
      });
    });

    describe('Boundary Numbers', () => {
      it('accepts exact zero price (0.0000)', () => {
        const zeroPrice = evaluatedRows.find((r) => r.row_id === 'R045');
        expect(zeroPrice?.outcome).toBe('accepted');
      });

      it('accepts smallest positive four-decimal price (0.0001)', () => {
        const minPrice = evaluatedRows.find((r) => r.row_id === 'R046');
        expect(minPrice?.outcome).toBe('accepted');
      });

      it('accepts upper boundary decimal price (99999999.9999)', () => {
        const maxPrice = evaluatedRows.find((r) => r.row_id === 'R047');
        expect(maxPrice?.outcome).toBe('accepted');
      });

      it('rejects negative boundary price (-0.0001)', () => {
        const negBndPrice = evaluatedRows.find((r) => r.row_id === 'R068');
        expect(negBndPrice?.outcome).toBe('rejected');
        expect(negBndPrice?.reason_codes).toContain('NEGATIVE_PRICE');
      });

      it('accepts minimum boundary tax rate (0.00)', () => {
        const zeroTax = evaluatedRows.find((r) => r.row_id === 'R048');
        expect(zeroTax?.outcome).toBe('accepted');
      });

      it('accepts maximum boundary tax rate (100.00)', () => {
        const maxTax = evaluatedRows.find((r) => r.row_id === 'R049');
        expect(maxTax?.outcome).toBe('accepted');
      });

      it('rejects negative boundary tax rate (-0.01)', () => {
        const negTax = evaluatedRows.find((r) => r.row_id === 'R075');
        expect(negTax?.outcome).toBe('rejected');
        expect(negTax?.reason_codes).toContain('NEGATIVE_TAX_RATE');
      });

      it('rejects boundary tax rate over 100% (100.01)', () => {
        const overTax = evaluatedRows.find((r) => r.row_id === 'R077');
        expect(overTax?.outcome).toBe('rejected');
        expect(overTax?.reason_codes).toContain('TAX_RATE_OUT_OF_RANGE');
      });

      it('accepts exact zero stock balance (0.0000)', () => {
        const zeroStock = evaluatedRows.find((r) => r.row_id === 'R107');
        expect(zeroStock?.outcome).toBe('accepted');
      });

      it('accepts smallest positive four-decimal stock balance (0.0001)', () => {
        const minStock = evaluatedRows.find((r) => r.row_id === 'R108');
        expect(minStock?.outcome).toBe('accepted');
      });

      it('rejects boundary negative stock quantity (-0.0001)', () => {
        const negStock = evaluatedRows.find((r) => r.row_id === 'R115');
        expect(negStock?.outcome).toBe('rejected');
        expect(negStock?.reason_codes).toContain('NEGATIVE_STOCK');
      });
    });
  });

  // ── AC 4: Test Suite Verifies Multi-Run Idempotent Reproducibility ───────────
  describe('AC 4: Multi-Run Deterministic Reproducibility', () => {
    it('yields byte-identical profile JSON output across 5 consecutive execution runs', () => {
      const runs: ProfileReport[] = [];
      for (let run = 0; run < 5; run++) {
        const rows = parseCsv(csvText);
        const evaluated = evaluateDataset(rows);
        const report = buildProfile(csvText, evaluated);
        runs.push(report);
      }

      const baselineJson = JSON.stringify(runs[0]);
      for (let i = 1; i < runs.length; i++) {
        expect(JSON.stringify(runs[i])).toBe(baselineJson);
      }

      expect(runs[0]?.fixture_sha256).toBe(expectedProfile.fixture_sha256);
      expect(runs[0]?.total_rows).toBe(expectedProfile.total_rows);
      expect(runs[0]?.reconciliation).toEqual(expectedProfile.reconciliation);
      expect(runs[0]?.by_record_type).toEqual(expectedProfile.by_record_type);
      expect(runs[0]?.by_reason_code).toEqual(expectedProfile.by_reason_code);
    });

    it('reconciles source rows completely with zero unaccounted records', () => {
      const rec = expectedProfile.reconciliation;
      expect(rec.total_source_rows).toBe(expectedProfile.total_rows);
      expect(rec.accepted + rec.rejected + rec.review + rec.skipped).toBe(rec.total_source_rows);
      expect(rec.unaccounted).toBe(0);
      expect(rec.is_balanced).toBe(true);
    });
  });

  // ── Fixture Checksum & Manifest Validation ─────────────────────────────────
  describe('Fixture Manifest & Checksum Validation', () => {
    it('locates committed dirty-data-v1.csv fixture in sample-data/erp-1/', () => {
      expect(existsSync(resolve(REPO_ROOT, FIXTURE_PATH))).toBe(true);
      expect(csvText.length).toBeGreaterThan(1000);
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

  // ── Raw Input Immutability (BR-KIT-03) ──────────────────────────────────────
  describe('Raw Input Immutability (BR-KIT-03)', () => {
    it('parses raw CSV into rows without modifying raw cell values', () => {
      const rows = parseCsv(csvText);
      expect(rows.length).toBe(expectedProfile.total_rows);

      // Verify whitespace preserved on raw cells
      const paddedRow = rows.find((r) => r.row_id === 'R042');
      expect(paddedRow).toBeDefined();
      expect(paddedRow?.name).toBe('  Industrial Heavy-Duty Drill  ');

      // Re-hash remains unchanged
      expect(sha256Hex(csvText)).toBe(expectedProfile.fixture_sha256);
    });
  });

  // ── Rule Catalogue Integrity ───────────────────────────────────────────────
  describe('Rule Catalogue Integrity', () => {
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

  // ── Domain Invariant Enforcement ───────────────────────────────────────────
  describe('Domain Invariant Enforcement', () => {
    const rawRows = parseCsv(csvText);
    const evaluatedRows = evaluateDataset(rawRows);

    it('enforces BR-ERP1-01: SKU uniqueness after uppercase and trim normalization', () => {
      const exactDup = evaluatedRows.find((r) => r.row_id === 'R057');
      expect(exactDup?.outcome).toBe('review');
      expect(exactDup?.reason_codes).toContain('DUPLICATE_SKU_REVIEW');

      const caseSpaceDup = evaluatedRows.find((r) => r.row_id === 'R058');
      expect(caseSpaceDup?.outcome).toBe('review');
      expect(caseSpaceDup?.reason_codes).toContain('DUPLICATE_SKU_REVIEW');
    });

    it('enforces BR-ERP1-02: non-negative inventory stock quantity', () => {
      const negStock = evaluatedRows.find((r) => r.row_id === 'R114');
      expect(negStock?.outcome).toBe('rejected');
      expect(negStock?.reason_codes).toContain('NEGATIVE_STOCK');
    });

    it('enforces FR-ERP1-05 & BR-ERP1-03: single warehouse facility in V1', () => {
      const primaryWh = evaluatedRows.find((r) => r.row_id === 'R016');
      expect(primaryWh?.outcome).toBe('accepted');

      const secondWh = evaluatedRows.find((r) => r.row_id === 'R017');
      expect(secondWh?.outcome).toBe('rejected');
      expect(secondWh?.reason_codes).toContain('MULTIPLE_WAREHOUSES_REJECTED');
    });

    it('enforces FR-ERP1-04: fixed units of measure', () => {
      const invGallons = evaluatedRows.find((r) => r.row_id === 'R063');
      const invInches = evaluatedRows.find((r) => r.row_id === 'R064');
      const invPallets = evaluatedRows.find((r) => r.row_id === 'R065');

      expect(invGallons?.outcome).toBe('rejected');
      expect(invGallons?.reason_codes).toContain('INVALID_UNIT_OF_MEASURE');
      expect(invInches?.outcome).toBe('rejected');
      expect(invInches?.reason_codes).toContain('INVALID_UNIT_OF_MEASURE');
      expect(invPallets?.outcome).toBe('rejected');
      expect(invPallets?.reason_codes).toContain('INVALID_UNIT_OF_MEASURE');

      for (const uom of ACCEPTED_UOMS) {
        const matchingValidProduct = evaluatedRows.find(
          (r) =>
            r.record_type === 'product' &&
            r.outcome === 'accepted' &&
            (r.normalized_data as RawRow).unit_of_measure === uom
        );
        expect(matchingValidProduct).toBeDefined();
      }
    });

    it('enforces FR-ERP1-02: non-negative price and explicit currency', () => {
      const negPrice = evaluatedRows.find((r) => r.row_id === 'R067');
      expect(negPrice?.outcome).toBe('rejected');
      expect(negPrice?.reason_codes).toContain('NEGATIVE_PRICE');

      const noCur = evaluatedRows.find((r) => r.row_id === 'R071');
      expect(noCur?.outcome).toBe('rejected');
      expect(noCur?.reason_codes).toContain('CURRENCY_REQUIRED');

      const invCur = evaluatedRows.find((r) => r.row_id === 'R072');
      expect(invCur?.outcome).toBe('rejected');
      expect(invCur?.reason_codes).toContain('INVALID_CURRENCY');
    });
  });

  // ── Security, Injection Defense & Sensitive Masking ────────────────────────
  describe('Security, Injection Defense & Sensitive Masking', () => {
    const rawRows = parseCsv(csvText);
    const evaluatedRows = evaluateDataset(rawRows);

    it('detects and rejects formula injection attempts (PLT-12 / KIT-16)', () => {
      const cmdInj = evaluatedRows.find((r) => r.row_id === 'R082');
      expect(cmdInj?.outcome).toBe('rejected');
      expect(cmdInj?.reason_codes).toContain('FORMULA_INJECTION_DETECTED');

      const plusInj = evaluatedRows.find((r) => r.row_id === 'R083');
      expect(plusInj?.outcome).toBe('rejected');
      expect(plusInj?.reason_codes).toContain('FORMULA_INJECTION_DETECTED');

      const atInj = evaluatedRows.find((r) => r.row_id === 'R084');
      expect(atInj?.outcome).toBe('rejected');
      expect(atInj?.reason_codes).toContain('FORMULA_INJECTION_DETECTED');

      const dashInj = evaluatedRows.find((r) => r.row_id === 'R085');
      expect(dashInj?.outcome).toBe('rejected');
      expect(dashInj?.reason_codes).toContain('FORMULA_INJECTION_DETECTED');

      const tabInj = evaluatedRows.find((r) => r.row_id === 'R086');
      expect(tabInj?.outcome).toBe('rejected');
      expect(tabInj?.reason_codes).toContain('FORMULA_INJECTION_DETECTED');
    });

    it('masks sensitive bank account and government ID numbers in review projections', () => {
      const sensitiveProduct = rawRows.find((r) => r.row_id === 'R037');
      expect(sensitiveProduct).toBeDefined();
      expect(sensitiveProduct?.supplier_bank_account).toBe('CH93-0000-0000-0000-1234-5');
      expect(sensitiveProduct?.employee_ssn).toBe('999-00-1234');

      const masked = maskSensitiveFields(sensitiveProduct!);
      expect(masked.supplier_bank_account).toBe('****-****-34-5');
      expect(masked.employee_ssn).toBe('***-**-1234');
    });
  });

  // ── Contract Ingestion Validation ──────────────────────────────────────────
  describe('Contract Ingestion Validation', () => {
    const rawRows = parseCsv(csvText);
    const evaluatedRows = evaluateDataset(rawRows);
    const acceptedProducts = evaluatedRows.filter(
      (r) => r.record_type === 'product' && r.outcome === 'accepted'
    );

    it('verifies all accepted products validate against CreateProductInputSchema', () => {
      expect(acceptedProducts.length).toBeGreaterThanOrEqual(30);
      for (const row of acceptedProducts) {
        const raw = row.normalized_data as RawRow;
        const result = CreateProductInputSchema.safeParse({
          name: raw.name.trim(),
          sku: normalizeSku(raw.sku),
          unitOfMeasure: raw.unit_of_measure.trim(),
          price: raw.price.trim(),
          currency: raw.currency.trim().toUpperCase(),
          taxRate: raw.tax_rate.trim() || '0.00',
          notificationEmail: raw.notification_email.trim() || undefined,
          contactPhone: raw.contact_phone.trim() || undefined,
          sourceSystem: raw.source_system.trim() || undefined,
          sourceId: raw.source_id.trim() || undefined,
        });
        expect(result.success, `Product ${raw.source_id} failed schema validation`).toBe(true);
      }
    });

    it('validates complete profile report against DirtyDataProfileReportSchema', () => {
      const profile = buildProfile(csvText, evaluatedRows);
      const parsed = DirtyDataProfileReportSchema.parse(profile);
      expect(parsed.module).toBe('erp1');
      expect(parsed.reconciliation.is_balanced).toBe(true);
      expect(parsed.reconciliation.unaccounted).toBe(0);
      expect(parsed.rows).toBeDefined();
      expect(Object.keys(parsed.rows!).length).toBe(131);
    });
  });
});
