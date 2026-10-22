/**
 * ERP-2 Vendors and Purchasing — Schema Contract Tests (Pure Unit / In-Memory)
 *
 * Tests prove:
 *   1. Module schema, tables, and enums surface
 *   2. DB-level check constraints carry documented invariant names
 *   3. Unique constraints match documented uniqueness rules
 *   4. Decision C7 ownership boundary — intra-module foreign keys only, no cross-module DB FKs
 *   5. DDL <-> Drizzle parity — every table, column, and constraint in
 *      packages/database/migrations/erp2_v1.sql exists in Drizzle model and vice versa
 *
 * @module erp2/tests/db/schema.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  erp2Schema,
  erp2Vendors,
  erp2PurchaseOrders,
  erp2PoLines,
  erp2ImportReceipts,
  purchaseOrderStatusEnum,
} from '@clearshift/database';

const MIGRATION_PATH = fileURLToPath(
  new URL('../../../../../../packages/database/migrations/erp2_v1.sql', import.meta.url)
);

const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8');

const MODULE_TABLES = {
  vendors: erp2Vendors,
  purchase_orders: erp2PurchaseOrders,
  po_lines: erp2PoLines,
  import_receipts: erp2ImportReceipts,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Module surface
// ─────────────────────────────────────────────────────────────────────────────
describe('ERP-2 schema surface', () => {
  it('owns the isolated `erp2` PostgreSQL schema', () => {
    expect(erp2Schema.schemaName).toBe('erp2');
  });

  it('exports every module table', () => {
    for (const [name, table] of Object.entries(MODULE_TABLES)) {
      const config = getTableConfig(table);
      expect(config.name).toBe(name);
      expect(config.schema).toBe('erp2');
    }
  });

  it('exports the purchase order status enum with SDS values (FR-ERP2-04)', () => {
    expect(purchaseOrderStatusEnum.enumValues).toEqual([
      'draft',
      'sent',
      'received',
      'closed',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Check constraints
// ─────────────────────────────────────────────────────────────────────────────
describe('DB-level check constraints', () => {
  const checkNames = (table: Parameters<typeof getTableConfig>[0]): string[] =>
    getTableConfig(table).checks.map((c) => c.name);

  it('[FR-ERP2-01] vendors enforce non-empty name and tax_number', () => {
    const names = checkNames(erp2Vendors);
    expect(names).toContain('vendors_name_not_empty');
    expect(names).toContain('vendors_tax_number_not_empty');
  });

  it('[FR-ERP2-06] vendors enforce bank detail mask format XXXX-XXXX-7890', () => {
    expect(checkNames(erp2Vendors)).toContain('vendors_bank_masked_format');
  });

  it('[FR-ERP2-03, FR-ERP2-05] purchase orders enforce non-empty po_number, 3-letter currency, non-negative total', () => {
    const names = checkNames(erp2PurchaseOrders);
    expect(names).toContain('purchase_orders_po_number_not_empty');
    expect(names).toContain('purchase_orders_currency_format');
    expect(names).toContain('purchase_orders_total_non_negative');
  });

  it('[FR-ERP2-03] po_lines enforce quantity > 0, price >= 0, line_total >= 0', () => {
    const names = checkNames(erp2PoLines);
    expect(names).toContain('po_lines_quantity_positive');
    expect(names).toContain('po_lines_price_non_negative');
    expect(names).toContain('po_lines_line_total_non_negative');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Uniqueness rules
// ─────────────────────────────────────────────────────────────────────────────
describe('DB-level uniqueness rules', () => {
  const uniqueNames = (table: Parameters<typeof getTableConfig>[0]): string[] => [
    ...getTableConfig(table).uniqueConstraints.map((c) => c.name),
    ...getTableConfig(table).indexes.filter((i) => i.config.unique).map((i) => i.config.name),
  ];

  it('vendor tax_number is unique', () => {
    expect(uniqueNames(erp2Vendors)).toContain('vendors_tax_number_unique');
  });

  it('purchase order po_number is unique', () => {
    expect(uniqueNames(erp2PurchaseOrders)).toContain('purchase_orders_po_number_unique');
  });

  it('po_lines enforce uniqueness on (po_id, line_number)', () => {
    expect(uniqueNames(erp2PoLines)).toContain('po_lines_po_line_number_unique');
  });

  it('import receipts are unique per idempotency key', () => {
    expect(uniqueNames(erp2ImportReceipts)).toContain('import_receipts_idempotency_key_unique');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Ownership boundary — Decision C7
// ─────────────────────────────────────────────────────────────────────────────
describe('Ownership boundary (Decision C7)', () => {
  it('every foreign key targets a table inside the `erp2` schema', () => {
    for (const table of Object.values(MODULE_TABLES)) {
      for (const fk of getTableConfig(table).foreignKeys) {
        const referenced = fk.reference().foreignTable;
        const referencedConfig = getTableConfig(referenced);
        expect(referencedConfig.schema).toBe('erp2');
      }
    }
  });

  it('declares expected intra-module relationships', () => {
    const poFks = getTableConfig(erp2PurchaseOrders).foreignKeys.map(
      (fk) => getTableConfig(fk.reference().foreignTable).name
    );
    expect(poFks).toEqual(['vendors']);

    const lineFks = getTableConfig(erp2PoLines).foreignKeys.map(
      (fk) => getTableConfig(fk.reference().foreignTable).name
    );
    expect(lineFks).toEqual(['purchase_orders']);
  });

  it('po_lines does NOT declare a database foreign key to erp1 (product_id is a logical reference)', () => {
    const lineFks = getTableConfig(erp2PoLines).foreignKeys.map(
      (fk) => getTableConfig(fk.reference().foreignTable).name
    );
    expect(lineFks).not.toContain('erp1_products');
    expect(lineFks).not.toContain('products');
  });

  it('import receipts carry no foreign keys', () => {
    expect(getTableConfig(erp2ImportReceipts).foreignKeys).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. DDL <-> Drizzle parity
// ─────────────────────────────────────────────────────────────────────────────
describe('Migration DDL <-> Drizzle model parity', () => {
  /** Extracts the body of a `CREATE TABLE IF NOT EXISTS erp2.<name> ( ... )` block. */
  function tableBlock(name: string): string {
    const start = migrationSql.indexOf(`CREATE TABLE IF NOT EXISTS erp2.${name} (`);
    expect(start, `migration must create erp2.${name}`).toBeGreaterThan(-1);
    const end = migrationSql.indexOf('\n);', start);
    expect(end, `migration must close the erp2.${name} block`).toBeGreaterThan(start);
    return migrationSql.slice(start, end);
  }

  /** Column names declared in the DDL table block. */
  function ddlColumnNames(name: string): string[] {
    const block = tableBlock(name);
    const names = new Set<string>();
    const columnPattern = /^\s{4}([a-z_][a-z0-9_]*)\s+(UUID|VARCHAR|INTEGER|DATE|TIMESTAMPTZ|NUMERIC|TEXT|erp2\.[a-z_]+)/gm;
    let match: RegExpExecArray | null;
    while ((match = columnPattern.exec(block)) !== null) {
      names.add(match[1]);
    }
    return [...names];
  }

  it('creates exactly the module tables declared in the Drizzle model', () => {
    const created = [...migrationSql.matchAll(/CREATE TABLE IF NOT EXISTS erp2\.(\w+)/g)].map(
      (m) => m[1]
    );
    expect(created.sort()).toEqual(Object.keys(MODULE_TABLES).sort());
  });

  it('declares the same columns in the DDL and in the Drizzle model', () => {
    for (const [name, table] of Object.entries(MODULE_TABLES)) {
      const ddlColumns = ddlColumnNames(name).sort();
      const drizzleColumns = getTableConfig(table).columns.map((c) => c.name).sort();
      expect(ddlColumns, `column parity for erp2.${name}`).toEqual(drizzleColumns);
    }
  });

  it('declares all check constraints in the migration file', () => {
    for (const table of Object.values(MODULE_TABLES)) {
      const checks = getTableConfig(table).checks;
      for (const chk of checks) {
        expect(
          migrationSql.includes(chk.name),
          `migration must declare check constraint ${chk.name}`
        ).toBe(true);
      }
    }
  });
});
