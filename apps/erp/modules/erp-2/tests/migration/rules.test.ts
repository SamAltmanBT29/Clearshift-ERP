/**
 * ERP-2 Vendors & Purchasing — V1 Data-Quality Rules Tests
 *
 * Proves the rule catalogue against the committed synthetic Dirty Data Pack:
 *   - fixture manifest + SHA-256 checksum + schema/version
 *   - rule catalogue integrity (stable ids, versions, reasons)
 *   - every required/optional field and enumeration has a valid and an invalid row
 *   - determinism (byte-equivalent profile) and raw-input immutability
 *   - no fuzzy matching, no automatic merge
 *   - domain invariants: BR-ERP2-01, FR-ERP2-04, FR-ERP2-05, FR-ERP2-06, amount/currency rules
 *   - rule output is accepted by the public API contract
 *
 * @module erp2/tests/migration/rules.test
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CreateVendorRequestSchema,
  CreatePurchaseOrderRequestSchema,
} from '@clearshift/contracts';
import {
  ACCEPTED_CURRENCIES,
  COVERED_FIELDS,
  FIXTURE_COLUMNS,
  FIXTURE_SCHEMA_VERSION,
  PO_STATUSES,
  RULES_VERSION,
  RULE_CATALOGUE,
  buildProfile,
  computeLineTotal,
  evaluateDataset,
  parseCsv,
  readRawRows,
  sha256Hex,
  stableStringify,
  type DatasetResult,
  type ProductResolver,
  type PurchaseOrderClean,
  type RawRow,
  type RowResult,
  type VendorClean,
} from '../../src/migration/rules.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures (read once, never modified)
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
const read = (relative: string): string => readFileSync(`${ROOT}${relative}`, 'utf8');

const CSV_TEXT = read('sample-data/erp-2/dirty-data-v1.csv');
const EXPECTED_TEXT = read('sample-data/erp-2/expected-profile.json');
const EXPECTED = JSON.parse(EXPECTED_TEXT) as ReturnType<typeof buildProfile>;
const MAPPING = JSON.parse(read('sample-data/erp-2/mapping-template.json')) as {
  policy: { fuzzy_matching: boolean; automatic_merge: boolean; raw_input_mutation: boolean };
  load_order: string[];
  reference_fixtures: { erp1_product_ids: string[] };
  entities: Record<
    string,
    {
      target_table: string;
      entity_rule_ids?: string[];
      fields: { source: string; rule_ids: string[] }[];
    }
  >;
};

const KNOWN_PRODUCTS = new Set(MAPPING.reference_fixtures.erp1_product_ids);

interface SpyResolver extends ProductResolver {
  readonly calls: { entity: string; id: string }[];
}

function makeResolver(known: ReadonlySet<string>): SpyResolver {
  const calls: { entity: string; id: string }[] = [];
  return {
    calls,
    async exists(entity: string, id: string): Promise<boolean> {
      calls.push({ entity, id });
      return entity === 'product' && known.has(id);
    },
  };
}

function must<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) throw new Error(`Missing ${label}`);
  return value;
}

const RAW_ROWS: readonly RawRow[] = readRawRows(CSV_TEXT);

async function run(resolver: ProductResolver = makeResolver(KNOWN_PRODUCTS)): Promise<DatasetResult> {
  return evaluateDataset(RAW_ROWS, resolver);
}

function rowResult(result: DatasetResult, rowId: string): RowResult {
  return must(
    result.rows.find((r) => r.row_id === rowId),
    `result for ${rowId}`
  );
}

function rawRow(rowId: string): RawRow {
  return must(
    RAW_ROWS.find((r) => r.row_id === rowId),
    `raw row ${rowId}`
  );
}

function reasonCodes(r: RowResult): string[] {
  return r.reasons.map((x) => x.reason_code).sort();
}

function tagsOf(row: RawRow): string[] {
  return row.case_tags === '' ? [] : row.case_tags.split('|');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Fixture manifest
// ─────────────────────────────────────────────────────────────────────────────

describe('ERP-2 Dirty Data Pack — committed manifest', () => {
  it('matches the committed SHA-256 checksum and schema version', () => {
    expect(sha256Hex(CSV_TEXT)).toBe(EXPECTED.fixture.sha256);
    expect(EXPECTED.fixture.schema_version).toBe(FIXTURE_SCHEMA_VERSION);
    expect(EXPECTED.rules_version).toBe(RULES_VERSION);
  });

  it('reports the known fixture counts', () => {
    expect(RAW_ROWS).toHaveLength(86);
    expect(EXPECTED.fixture.row_count).toBe(86);
    expect(EXPECTED.fixture.by_record_type).toEqual({ vendor: 21, purchase_order: 31, po_line: 34 });
  });

  it('has exactly the documented columns, unique row ids and LF line endings', () => {
    const header = must(parseCsv(CSV_TEXT)[0], 'header');
    expect(header).toEqual([...FIXTURE_COLUMNS]);
    expect(new Set(RAW_ROWS.map((r) => r.row_id)).size).toBe(RAW_ROWS.length);
    expect(CSV_TEXT.includes('\r')).toBe(false);
  });

  it('refuses a file with a different header', () => {
    expect(() => readRawRows('a,b,c\n1,2,3\n')).toThrow(/header mismatch/i);
  });

  it('contains only synthetic data (test domains and made-up identifiers)', () => {
    for (const row of RAW_ROWS) {
      if (row.email.includes('@')) expect(row.email.trim().toLowerCase()).toMatch(/\.test$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Rule catalogue
// ─────────────────────────────────────────────────────────────────────────────

describe('ERP-2 rule catalogue', () => {
  it('has stable, unique rule ids and a fixed size', () => {
    const ids = RULE_CATALOGUE.map((r) => r.rule_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(VND|PUR|LIN)-\d{3}$/);
    expect(RULE_CATALOGUE).toHaveLength(62);
  });

  it('gives every rule a version, input condition and human-readable reason', () => {
    for (const r of RULE_CATALOGUE) {
      expect(r.version).toBe(RULES_VERSION);
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.input_condition.length).toBeGreaterThan(5);
      expect(r.reason.length).toBeGreaterThan(5);
    }
  });

  it('gives every reject/review rule a unique reason code and no other rule one', () => {
    const codes: string[] = [];
    for (const r of RULE_CATALOGUE) {
      if (r.result === 'reject' || r.result === 'review') {
        expect(r.reason_code).toMatch(/^[A-Z][A-Z0-9_]+$/);
        codes.push(`${r.entity}:${r.reason_code}`);
      } else {
        expect(r.reason_code).toBeNull();
      }
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('is fully exercised: every reject/review rule and every normalize rule fires on the fixture', () => {
    for (const r of RULE_CATALOGUE) {
      if (r.result === 'reject' || r.result === 'review') {
        expect(EXPECTED.by_rule_id[r.rule_id], `rule ${r.rule_id} never fires`).toBeGreaterThan(0);
      }
      if (r.result === 'normalize') {
        expect(EXPECTED.normalizations[r.rule_id], `rule ${r.rule_id} never normalizes`).toBeGreaterThan(0);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Per-row outcomes against the hand-written expectations in the fixture
// ─────────────────────────────────────────────────────────────────────────────

describe('ERP-2 per-row outcomes', () => {
  it('produces exactly the expected outcome and reason codes for every fixture row', async () => {
    const result = await run();
    expect(result.rows).toHaveLength(RAW_ROWS.length);
    for (const row of RAW_ROWS) {
      const got = rowResult(result, row.row_id);
      const want = row.expect_reasons === '' ? [] : row.expect_reasons.split('|');
      expect(got.outcome, `${row.row_id} outcome`).toBe(row.expect_outcome);
      expect(reasonCodes(got), `${row.row_id} reasons`).toEqual(want);
    }
  });

  it('returns results in input order', async () => {
    const result = await run();
    expect(result.rows.map((r) => r.row_id)).toEqual(RAW_ROWS.map((r) => r.row_id));
  });

  it('only ever uses the outcomes accepted, rejected and review (no automatic merge)', async () => {
    const result = await run();
    for (const r of result.rows) expect(['accepted', 'rejected', 'review']).toContain(r.outcome);
    expect(EXPECTED.outcomes).toEqual({ accepted: 16, rejected: 66, review: 4 });
  });

  it('attaches the field and rule id to every reason', async () => {
    const result = await run();
    for (const r of result.rows) {
      for (const hit of r.reasons) {
        expect(hit.rule_id).toMatch(/^(VND|PUR|LIN)-\d{3}$/);
        expect(hit.field.length).toBeGreaterThan(0);
        expect(hit.message.length).toBeGreaterThan(5);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Field / enumeration coverage matrix
// ─────────────────────────────────────────────────────────────────────────────

describe('ERP-2 field coverage: one valid and one invalid row per field', () => {
  it('tags at least one valid and one invalid row for every required, optional and enumerated field', () => {
    for (const field of COVERED_FIELDS) {
      const validRows = RAW_ROWS.filter((r) => tagsOf(r).includes(`${field}:valid`));
      const invalidRows = RAW_ROWS.filter((r) => tagsOf(r).includes(`${field}:invalid`));
      expect(validRows.length, `${field} has no valid row`).toBeGreaterThan(0);
      expect(invalidRows.length, `${field} has no invalid row`).toBeGreaterThan(0);
    }
  });

  it('confirms the engine agrees with every tag: valid rows have no reason on the field, invalid rows have one', async () => {
    const result = await run();
    for (const row of RAW_ROWS) {
      const got = rowResult(result, row.row_id);
      for (const tag of tagsOf(row)) {
        const [path = '', verdict = ''] = tag.split(':');
        const fieldName = path.split('.')[1] ?? '';
        const onField = got.reasons.filter((h) => h.field === fieldName);
        if (verdict === 'valid') {
          expect(onField, `${row.row_id} ${tag}`).toEqual([]);
        } else {
          expect(onField.length, `${row.row_id} ${tag}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('covers every accepted currency and every purchase-order status with an accepted row', async () => {
    const result = await run();
    const vendors = result.rows.filter((r) => r.outcome === 'accepted' && r.record_type === 'vendor');
    const orders = result.rows.filter((r) => r.outcome === 'accepted' && r.record_type === 'purchase_order');
    const vendorCurrencies = new Set(vendors.map((r) => (r.clean as VendorClean).currency));
    const orderCurrencies = new Set(orders.map((r) => (r.clean as PurchaseOrderClean).currency));
    const statuses = new Set(orders.map((r) => (r.clean as PurchaseOrderClean).post_load_status));
    for (const c of ACCEPTED_CURRENCIES) {
      expect(vendorCurrencies.has(c), `vendor currency ${c}`).toBe(true);
      expect(orderCurrencies.has(c), `order currency ${c}`).toBe(true);
    }
    expect([...statuses].sort()).toEqual([...PO_STATUSES].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Determinism and raw-input immutability
// ─────────────────────────────────────────────────────────────────────────────

describe('ERP-2 determinism and raw input', () => {
  it('yields a byte-equivalent profile on every run, equal to the committed expected-profile.json', async () => {
    const first = stableStringify(buildProfile(CSV_TEXT, RAW_ROWS, await run()));
    const second = stableStringify(buildProfile(CSV_TEXT, RAW_ROWS, await run()));
    expect(first).toBe(second);
    expect(first).toBe(EXPECTED_TEXT);
  });

  it('yields identical full results (not only counts) on every run', async () => {
    const a = JSON.stringify(await run());
    const b = JSON.stringify(await run());
    expect(a).toBe(b);
  });

  it('does not depend on the order resolver calls complete in', async () => {
    const slowFirst: ProductResolver = {
      async exists(_entity: string, id: string): Promise<boolean> {
        await new Promise((resolve) => setTimeout(resolve, id.startsWith('1') ? 5 : 0));
        return KNOWN_PRODUCTS.has(id);
      },
    };
    expect(JSON.stringify(await run(slowFirst))).toBe(JSON.stringify(await run()));
  });

  it('leaves raw cells and the raw checksum unchanged after profiling, cleaning and mapping', async () => {
    const before = JSON.stringify(RAW_ROWS);
    const checksumBefore = sha256Hex(CSV_TEXT);
    await run();
    buildProfile(CSV_TEXT, RAW_ROWS, await run());
    expect(JSON.stringify(RAW_ROWS)).toBe(before);
    expect(sha256Hex(CSV_TEXT)).toBe(checksumBefore);
    expect(JSON.stringify(readRawRows(CSV_TEXT))).toBe(before);
  });

  it('keeps raw whitespace and casing verbatim and freezes every raw row', () => {
    const messy = rawRow('R002');
    expect(messy.name).toBe('  Beta   Parts  Ltd ');
    expect(messy.tax_number).toBe(' tx-beta-002 ');
    expect(messy.currency).toBe(' eur ');
    expect(Object.isFrozen(RAW_ROWS)).toBe(true);
    for (const row of RAW_ROWS) expect(Object.isFrozen(row)).toBe(true);
    expect(() => {
      (messy as unknown as Record<string, string>)['name'] = 'changed';
    }).toThrow();
  });

  it('writes cleaned values to new objects, so normalization never touches the raw row', async () => {
    const result = await run();
    const clean = must(rowResult(result, 'R002').clean, 'clean R002') as VendorClean;
    expect(clean.name).toBe('Beta Parts Ltd');
    expect(clean.tax_number).toBe('TX-BETA-002');
    expect(clean.email).toBe('sales@beta.test');
    expect(clean.phone).toBe('5550100200');
    expect(clean.currency).toBe('EUR');
    expect(rowResult(result, 'R002').normalized_by).toEqual(
      ['VND-010', 'VND-011', 'VND-012', 'VND-013', 'VND-014', 'VND-015', 'VND-016']
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. No fuzzy matching, no automatic merge
// ─────────────────────────────────────────────────────────────────────────────

describe('ERP-2 duplicates: exact keys only, review required, never merged', () => {
  it('holds exact duplicate tax numbers for review and keeps the first row', async () => {
    const result = await run();
    const first = rowResult(result, 'R001');
    const dupe = rowResult(result, 'R018'); // " tx-acme-001 " normalizes to TX-ACME-001
    expect(first.outcome).toBe('accepted');
    expect(dupe.outcome).toBe('review');
    expect(dupe.duplicate_of).toBe('R001');
    expect(dupe.clean).toBeNull();
    expect(reasonCodes(dupe)).toEqual(['DUPLICATE_TAX_NUMBER_REVIEW']);
    expect(rowResult(result, 'R019').duplicate_of).toBe('R002');
  });

  it('does not treat near-matches as duplicates (identical name, one-character-different tax number)', async () => {
    const result = await run();
    expect(rawRow('R020').name).toBe(rawRow('R001').name);
    expect(rowResult(result, 'R020').outcome).toBe('accepted');
    expect(rowResult(result, 'R020').duplicate_of).toBeNull();
  });

  it('holds exact duplicate PO numbers for review together with their lines', async () => {
    const result = await run();
    const dupeOrder = must(
      result.rows.find((r) => r.record_type === 'purchase_order' && r.reasons.some((h) => h.reason_code === 'DUPLICATE_PO_NUMBER_REVIEW')),
      'duplicate PO'
    );
    expect(dupeOrder.outcome).toBe('review');
    expect(dupeOrder.clean).toBeNull();
    expect(dupeOrder.duplicate_of).not.toBeNull();
    const heldLines = result.rows.filter((r) => r.reasons.some((h) => h.reason_code === 'PARENT_PO_IN_REVIEW'));
    expect(heldLines).toHaveLength(1);
    expect(heldLines[0]?.outcome).toBe('review');
  });

  it('never loads a review row: only accepted rows carry clean data', async () => {
    const result = await run();
    for (const r of result.rows) {
      if (r.outcome !== 'accepted') expect(r.clean, r.row_id).toBeNull();
      else expect(r.clean, r.row_id).not.toBeNull();
    }
  });

  it('declares no fuzzy matching, no automatic merge and no raw mutation in the mapping template', () => {
    expect(MAPPING.policy.fuzzy_matching).toBe(false);
    expect(MAPPING.policy.automatic_merge).toBe(false);
    expect(MAPPING.policy.raw_input_mutation).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Domain invariants
// ─────────────────────────────────────────────────────────────────────────────

describe('BR-ERP2-01: every purchase-order line references an existing ERP-1 product', () => {
  it('asks the ERP-1 resolver for entity "product" and rejects unknown ids with UNKNOWN_PRODUCT', async () => {
    const resolver = makeResolver(KNOWN_PRODUCTS);
    const result = await run(resolver);
    expect(resolver.calls.length).toBeGreaterThan(0);
    for (const call of resolver.calls) expect(call.entity).toBe('product');
    const unknown = must(result.rows.find((r) => r.reasons.some((h) => h.reason_code === 'UNKNOWN_PRODUCT')), 'unknown product row');
    expect(unknown.outcome).toBe('rejected');
    expect(unknown.record_type).toBe('po_line');
    expect(unknown.reasons[0]?.rule_id).toBe('LIN-040');
  });

  it('does not call the resolver for blank or malformed product ids (stable reject instead)', async () => {
    const resolver = makeResolver(KNOWN_PRODUCTS);
    await run(resolver);
    expect(resolver.calls.some((c) => c.id === 'not-a-uuid' || c.id === '')).toBe(false);
  });

  it('accepts no order at all when ERP-1 knows no products', async () => {
    const result = await run(makeResolver(new Set()));
    expect(result.rows.filter((r) => r.record_type === 'purchase_order' && r.outcome === 'accepted')).toHaveLength(0);
    expect(result.rows.filter((r) => r.record_type === 'po_line' && r.outcome === 'accepted')).toHaveLength(0);
    const lineReasons = new Set(result.rows.filter((r) => r.record_type === 'po_line').flatMap(reasonCodes));
    expect(lineReasons.has('UNKNOWN_PRODUCT')).toBe(true);
  });

  it('rejects the whole order when one line is bad and holds back its good lines', async () => {
    const result = await run();
    const order = must(result.rows.find((r) => r.reasons.some((h) => h.reason_code === 'LINE_REJECTED') && r.record_type === 'purchase_order'), 'order with bad line');
    expect(order.outcome).toBe('rejected');
    expect(order.clean).toBeNull();
    const overflowOrder = must(result.rows.find((r) => r.reasons.some((h) => h.reason_code === 'TOTAL_OVERFLOW')), 'overflow order');
    expect(overflowOrder.outcome).toBe('rejected');
  });

  it('rejects orphan lines and unresolved or rejected vendor references with stable reasons', async () => {
    const result = await run();
    const codes = new Set(result.rows.flatMap(reasonCodes));
    for (const code of ['ORPHAN_LINE', 'VENDOR_NOT_FOUND', 'VENDOR_REJECTED', 'PARENT_PO_REJECTED']) {
      expect(codes.has(code), code).toBe(true);
    }
  });
});

describe('FR-ERP2-05: totals are computed from lines with decimal arithmetic', () => {
  it('computes accepted order totals from lines and ignores the total in the source file', async () => {
    const result = await run();
    const first = must(result.rows.find((r) => r.record_type === 'purchase_order' && r.outcome === 'accepted'), 'first order');
    expect(rawRow(first.row_id).client_total).toBe('9999.99');
    expect((first.clean as PurchaseOrderClean).total).toBe('215.75');
    expect(EXPECTED.accepted_purchase_order_totals).toEqual({
      'PO-SRC-001': '215.75',
      'PO-SRC-002': '2500.00',
      'PO-SRC-003': '0.00',
      'PO-SRC-004': '0.06',
    });
  });

  it('rounds each line half-up to 2 decimals (not banker rounding, not floating point)', () => {
    expect(computeLineTotal('0.05', '0.10')).toBe('0.01'); // 0.005
    expect(computeLineTotal('0.15', '0.10')).toBe('0.02'); // 0.015
    expect(computeLineTotal('0.25', '0.10')).toBe('0.03'); // 0.025
    expect(computeLineTotal('3.00', '0.10')).toBe('0.30');
    expect(computeLineTotal('0.01', '0.01')).toBe('0.00'); // 0.0001
    expect(computeLineTotal('10.00', '15.50')).toBe('155.00');
    expect(computeLineTotal('1000.00', '2.50')).toBe('2500.00');
  });

  it('stays exact at the NUMERIC limits', () => {
    expect(computeLineTotal('9999999999.99', '9999999999999999.99')).toBe('99999999999899999900000000.00');
  });
});

describe('FR-ERP2-04: purchase-order status enumeration', () => {
  it('knows exactly Draft, Sent, Received, Closed in forward order', () => {
    expect([...PO_STATUSES]).toEqual(['Draft', 'Sent', 'Received', 'Closed']);
  });

  it('rejects Cancelled and any other status with INVALID_STATUS, and a blank status with STATUS_REQUIRED', async () => {
    const result = await run();
    const cancelled = must(result.rows.find((r) => r.record_type === 'purchase_order' && rawRow(r.row_id).status === 'Cancelled'), 'cancelled order');
    expect(reasonCodes(cancelled)).toEqual(['INVALID_STATUS']);
    const blank = must(result.rows.find((r) => r.record_type === 'purchase_order' && rawRow(r.row_id).status === ''), 'blank status order');
    expect(reasonCodes(blank)).toEqual(['STATUS_REQUIRED']);
  });

  it('normalizes case and whitespace of an otherwise valid status', async () => {
    const result = await run();
    const order = must(result.rows.find((r) => r.record_type === 'purchase_order' && rawRow(r.row_id).status === ' sent '), 'sent order');
    expect((order.clean as PurchaseOrderClean).post_load_status).toBe('Sent');
    expect(order.normalized_by).toContain('PUR-013');
  });
});

describe('Amounts and currency: non-negative NUMERIC(18,2), explicit ISO code, no FX', () => {
  it('rejects negative, over-precise, malformed, zero-quantity and overflowing amounts', async () => {
    const result = await run();
    const codes = new Set(result.rows.filter((r) => r.record_type === 'po_line').flatMap(reasonCodes));
    for (const code of ['NEGATIVE_AMOUNT', 'EXCESS_DECIMAL_PLACES', 'INVALID_PRICE_FORMAT', 'INVALID_QUANTITY_FORMAT', 'QUANTITY_NOT_POSITIVE', 'AMOUNT_OVERFLOW']) {
      expect(codes.has(code), code).toBe(true);
    }
  });

  it('accepts a zero price and pads every accepted amount to exactly 2 decimals', async () => {
    const result = await run();
    const free = must(result.rows.find((r) => r.record_type === 'po_line' && r.outcome === 'accepted' && rawRow(r.row_id).price === '0'), 'zero price line');
    expect(free.clean).toMatchObject({ price: '0.00', line_total: '0.00' });
    for (const r of result.rows) {
      if (r.record_type !== 'po_line' || r.clean === null) continue;
      expect(r.clean).toMatchObject({ quantity: expect.stringMatching(/^\d+\.\d{2}$/), price: expect.stringMatching(/^\d+\.\d{2}$/) });
    }
  });

  it('removes thousands separators but never rounds an over-precise amount', async () => {
    const result = await run();
    const thousand = must(result.rows.find((r) => r.record_type === 'po_line' && rawRow(r.row_id).quantity === '1,000'), 'thousands line');
    expect(thousand.clean).toMatchObject({ quantity: '1000.00', price: '2.50', line_total: '2500.00' });
    const precise = must(result.rows.find((r) => r.record_type === 'po_line' && rawRow(r.row_id).quantity === '1.234'), 'precise line');
    expect(precise.outcome).toBe('rejected');
  });

  it('requires an explicit accepted currency on vendors and orders (no default, no FX)', async () => {
    const result = await run();
    for (const type of ['vendor', 'purchase_order'] as const) {
      const blank = must(result.rows.find((r) => r.record_type === type && rawRow(r.row_id).currency === ''), `blank ${type} currency`);
      expect(reasonCodes(blank)).toEqual(['CURRENCY_REQUIRED']);
      const bad = must(result.rows.find((r) => r.record_type === type && rawRow(r.row_id).currency === 'XYZ'), `bad ${type} currency`);
      expect(reasonCodes(bad)).toEqual(['INVALID_CURRENCY']);
    }
    expect([...ACCEPTED_CURRENCIES]).toEqual(['USD', 'EUR', 'GBP']);
  });

  it('rejects day-first and month-first dates instead of guessing, and impossible calendar dates', async () => {
    const result = await run();
    const codes = new Set(result.rows.filter((r) => r.record_type === 'purchase_order').flatMap(reasonCodes));
    expect(codes.has('AMBIGUOUS_DATE_FORMAT')).toBe(true);
    expect(codes.has('INVALID_ORDER_DATE')).toBe(true);
    const slashed = must(result.rows.find((r) => r.record_type === 'purchase_order' && rawRow(r.row_id).order_date === '2026/10/02'), 'slashed date');
    expect((slashed.clean as PurchaseOrderClean).order_date).toBe('2026-10-02');
  });
});

describe('FR-ERP2-06: bank details are never reported unmasked', () => {
  it('reports only XXXX-XXXX-<last 4 digits>', async () => {
    const result = await run();
    const acme = must(rowResult(result, 'R001').clean, 'acme') as VendorClean;
    expect(acme.bank_masked).toBe('XXXX-XXXX-1234');
    for (const r of result.rows) {
      if (r.record_type !== 'vendor' || r.clean === null) continue;
      const masked = (r.clean as VendorClean).bank_masked;
      if (masked !== null) expect(masked).toMatch(/^XXXX-XXXX-\d{4}$/);
    }
  });

  it('keeps raw account numbers out of the profile and out of every reason message', async () => {
    const result = await run();
    const profileText = stableStringify(buildProfile(CSV_TEXT, RAW_ROWS, result));
    const reasonText = JSON.stringify(result.rows.map((r) => r.reasons));
    for (const row of RAW_ROWS) {
      const digits = row.bank_details.replace(/\D/g, '');
      if (digits.length < 8) continue;
      expect(profileText.includes(digits), row.row_id).toBe(false);
      expect(reasonText.includes(digits), row.row_id).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Public API contract compatibility and mapping template
// ─────────────────────────────────────────────────────────────────────────────

describe('Rule output is accepted by the public ERP-2 contract', () => {
  it('turns every accepted vendor into a valid CreateVendorRequest', async () => {
    const result = await run();
    const vendors = result.rows.filter((r) => r.record_type === 'vendor' && r.outcome === 'accepted');
    expect(vendors).toHaveLength(5);
    for (const r of vendors) {
      const clean = r.clean as VendorClean;
      const { bank_masked: _masked, ...body } = clean;
      const parsed = CreateVendorRequestSchema.safeParse(body);
      expect(parsed.success, `${r.row_id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it('turns every accepted order into a valid CreatePurchaseOrderRequest', async () => {
    const result = await run();
    const orders = result.rows.filter((r) => r.record_type === 'purchase_order' && r.outcome === 'accepted');
    expect(orders).toHaveLength(4);
    for (const r of orders) {
      const clean = r.clean as PurchaseOrderClean;
      const body = {
        ...(clean.po_number === null ? {} : { po_number: clean.po_number }),
        vendor_id: '00000000-0000-0000-0000-000000000001',
        order_date: clean.order_date,
        currency: clean.currency,
        lines: clean.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, price: l.price })),
      };
      const parsed = CreatePurchaseOrderRequestSchema.safeParse(body);
      expect(parsed.success, `${r.row_id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });
});

describe('Mapping template', () => {
  const catalogueIds = new Set(RULE_CATALOGUE.map((r) => r.rule_id));

  it('loads vendors before purchase orders and names the module tables', () => {
    expect(MAPPING.load_order).toEqual(['vendor', 'purchase_order']);
    expect(must(MAPPING.entities['vendor'], 'vendor').target_table).toBe('erp2.vendors');
    expect(must(MAPPING.entities['purchase_order'], 'purchase_order').target_table).toBe('erp2.purchase_orders');
    expect(must(MAPPING.entities['po_line'], 'po_line').target_table).toBe('erp2.po_lines');
  });

  it('only references real rule ids and real fixture columns', () => {
    for (const entity of Object.values(MAPPING.entities)) {
      for (const field of entity.fields) {
        expect((FIXTURE_COLUMNS as readonly string[]).includes(field.source), field.source).toBe(true);
        for (const id of field.rule_ids) expect(catalogueIds.has(id), id).toBe(true);
      }
    }
  });

  it('maps every covered field and uses every reject/review rule at least once', () => {
    const mapped = new Set<string>();
    const used = new Set<string>();
    for (const [name, entity] of Object.entries(MAPPING.entities)) {
      for (const id of entity.entity_rule_ids ?? []) used.add(id);
      for (const field of entity.fields) {
        mapped.add(`${name}.${field.source}`);
        for (const id of field.rule_ids) used.add(id);
      }
    }
    for (const field of COVERED_FIELDS) {
      if (field === 'purchase_order.lines') continue; // children, described under "children"
      expect(mapped.has(field), field).toBe(true);
    }
    for (const r of RULE_CATALOGUE) {
      if (r.result === 'reject' || r.result === 'review') expect(used.has(r.rule_id), r.rule_id).toBe(true);
    }
  });
});
