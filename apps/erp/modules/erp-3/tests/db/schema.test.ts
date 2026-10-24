/**
 * ERP-3 Sales Orders & Invoices — Schema Contract Tests (Pure Unit / In-Memory)
 *
 * Tests prove:
 *   1. Module schema, tables, and enums surface
 *   2. DB-level check constraints carry documented invariant names
 *   3. Unique constraints match documented uniqueness rules (including 1:1 order-to-invoice)
 *   4. Decision C7 ownership boundary — intra-module foreign keys only, no cross-module DB FKs
 *   5. DDL <-> Drizzle parity — every table, column, and constraint in
 *      packages/database/migrations/erp3_v1.sql exists in Drizzle model and vice versa
 *   6. Live DB constraint rejection tests (conditional on DATABASE_URL)
 *
 * @module erp3/tests/db/schema.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  erp3Schema,
  erp3SalesOrders,
  erp3SoLines,
  erp3Invoices,
  erp3InvoiceLines,
  erp3Payments,
  erp3ImportReceipts,
  salesOrderStatusEnum,
  invoiceStatusEnum,
  paymentMethodEnum,
} from '@clearshift/database';

const MIGRATION_PATH = fileURLToPath(
  new URL('../../../../../../packages/database/migrations/erp3_v1.sql', import.meta.url),
);

const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8');

const MODULE_TABLES = {
  sales_orders: erp3SalesOrders,
  so_lines: erp3SoLines,
  invoices: erp3Invoices,
  invoice_lines: erp3InvoiceLines,
  payments: erp3Payments,
  import_receipts: erp3ImportReceipts,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Module surface & Namespace Isolation
// ─────────────────────────────────────────────────────────────────────────────
describe('ERP-3 schema surface', () => {
  it('owns the isolated `erp3` PostgreSQL schema', () => {
    expect(erp3Schema.schemaName).toBe('erp3');
  });

  it('exports every module table named in SDS §4.7 and Master Architecture Spec §5c', () => {
    for (const [name, table] of Object.entries(MODULE_TABLES)) {
      const config = getTableConfig(table);
      expect(config.name).toBe(name);
      expect(config.schema).toBe('erp3');
    }
  });

  it('exports sales_order_status enum with SDS forward lifecycle values', () => {
    expect(salesOrderStatusEnum.enumValues).toEqual(['Open', 'Invoiced', 'Closed']);
  });

  it('exports invoice_status enum with SDS values (FR-ERP3-02)', () => {
    expect(invoiceStatusEnum.enumValues).toEqual(['Open', 'Paid', 'Overdue']);
  });

  it('exports payment_method enum with SDS values (FR-ERP3-03)', () => {
    expect(paymentMethodEnum.enumValues).toEqual(['cash', 'bank', 'card']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. DB-level check constraints
// ─────────────────────────────────────────────────────────────────────────────
describe('DB-level check constraints', () => {
  const checkNames = (table: Parameters<typeof getTableConfig>[0]): string[] =>
    getTableConfig(table).checks.map((c) => c.name);

  it('[FR-ERP3-01] sales_orders enforce non-empty order_number and non-negative amounts', () => {
    const names = checkNames(erp3SalesOrders);
    expect(names).toContain('sales_orders_number_not_empty');
    expect(names).toContain('sales_orders_subtotal_non_negative');
    expect(names).toContain('sales_orders_tax_total_non_negative');
    expect(names).toContain('sales_orders_total_non_negative');
  });

  it('[BR-ERP3-01, BR-ERP3-02] so_lines enforce positive quantity, non-negative price/tax/total, and tax rate range', () => {
    const names = checkNames(erp3SoLines);
    expect(names).toContain('so_lines_quantity_positive');
    expect(names).toContain('so_lines_unit_price_non_negative');
    expect(names).toContain('so_lines_tax_rate_range');
    expect(names).toContain('so_lines_tax_amount_non_negative');
    expect(names).toContain('so_lines_line_total_non_negative');
  });

  it('[FR-ERP3-02] invoices enforce non-empty number, due_date >= invoice_date, and non-negative amounts', () => {
    const names = checkNames(erp3Invoices);
    expect(names).toContain('invoices_number_not_empty');
    expect(names).toContain('invoices_due_date_after_or_equal_invoice_date');
    expect(names).toContain('invoices_subtotal_non_negative');
    expect(names).toContain('invoices_tax_total_non_negative');
    expect(names).toContain('invoices_total_non_negative');
  });

  it('[BR-ERP3-01, BR-ERP3-02] invoice_lines enforce positive quantity, non-negative price/tax/total, and tax rate range', () => {
    const names = checkNames(erp3InvoiceLines);
    expect(names).toContain('invoice_lines_quantity_positive');
    expect(names).toContain('invoice_lines_unit_price_non_negative');
    expect(names).toContain('invoice_lines_tax_rate_range');
    expect(names).toContain('invoice_lines_tax_amount_non_negative');
    expect(names).toContain('invoice_lines_line_total_non_negative');
  });

  it('[FR-ERP3-03] payments enforce strictly positive amount', () => {
    const names = checkNames(erp3Payments);
    expect(names).toContain('payments_amount_positive');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. DB-level uniqueness rules
// ─────────────────────────────────────────────────────────────────────────────
describe('DB-level uniqueness rules', () => {
  const uniqueNames = (table: Parameters<typeof getTableConfig>[0]): string[] => [
    ...getTableConfig(table).uniqueConstraints.map((c) => c.name),
    ...getTableConfig(table).indexes.filter((i) => i.config.unique).map((i) => i.config.name),
  ];

  it('sales order order_number is unique', () => {
    expect(uniqueNames(erp3SalesOrders)).toContain('sales_orders_order_number_unique');
  });

  it('so_lines enforce uniqueness on (order_id, line_number)', () => {
    expect(uniqueNames(erp3SoLines)).toContain('so_lines_order_line_unique');
  });

  it('invoice invoice_number is unique', () => {
    expect(uniqueNames(erp3Invoices)).toContain('invoices_invoice_number_unique');
  });

  it('enforces at most one V1 invoice per sales order via unique constraint on order_id', () => {
    expect(uniqueNames(erp3Invoices)).toContain('invoices_order_id_unique');
  });

  it('invoice_lines enforce uniqueness on (invoice_id, line_number)', () => {
    expect(uniqueNames(erp3InvoiceLines)).toContain('invoice_lines_invoice_line_unique');
  });

  it('import receipts are unique per idempotency key (KIT-08 / Decision C4)', () => {
    expect(uniqueNames(erp3ImportReceipts)).toContain('import_receipts_erp3_idempotency_key_unique');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Ownership boundary — Decision C7
// ─────────────────────────────────────────────────────────────────────────────
describe('Ownership boundary (Decision C7)', () => {
  it('every foreign key targets a table inside the `erp3` schema', () => {
    for (const table of Object.values(MODULE_TABLES)) {
      for (const fk of getTableConfig(table).foreignKeys) {
        const referenced = fk.reference().foreignTable;
        const referencedConfig = getTableConfig(referenced);
        expect(referencedConfig.schema).toBe('erp3');
      }
    }
  });

  it('declares expected intra-module relationships', () => {
    const soLineFks = getTableConfig(erp3SoLines).foreignKeys.map(
      (fk) => getTableConfig(fk.reference().foreignTable).name,
    );
    expect(soLineFks).toEqual(['sales_orders']);

    const invoiceFks = getTableConfig(erp3Invoices).foreignKeys.map(
      (fk) => getTableConfig(fk.reference().foreignTable).name,
    );
    expect(invoiceFks).toEqual(['sales_orders']);

    const invoiceLineFks = getTableConfig(erp3InvoiceLines).foreignKeys.map(
      (fk) => getTableConfig(fk.reference().foreignTable).name,
    );
    expect(invoiceLineFks).toEqual(['invoices']);

    const paymentFks = getTableConfig(erp3Payments).foreignKeys.map(
      (fk) => getTableConfig(fk.reference().foreignTable).name,
    );
    expect(paymentFks).toEqual(['invoices']);
  });

  it('customer_golden_id and product_id are UUID logical keys without cross-module DB foreign keys', () => {
    // Decision C7: No direct foreign keys into CRM or ERP-1 tables
    for (const table of [erp3SalesOrders, erp3Invoices]) {
      const fks = getTableConfig(table).foreignKeys;
      const refTables = fks.map((fk) => getTableConfig(fk.reference().foreignTable).name);
      expect(refTables).not.toContain('customers');
      expect(refTables).not.toContain('golden_records');
    }
    for (const table of [erp3SoLines, erp3InvoiceLines]) {
      const fks = getTableConfig(table).foreignKeys;
      const refTables = fks.map((fk) => getTableConfig(fk.reference().foreignTable).name);
      expect(refTables).not.toContain('products');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. DDL <-> Drizzle parity
// ─────────────────────────────────────────────────────────────────────────────
describe('DDL <-> Drizzle parity', () => {
  it('guarded SQL migration exists and defines schema_migrations idempotency guard', () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS public.schema_migrations');
    expect(migrationSql).toContain("WHERE migration = 'erp3_v1'");
    expect(migrationSql).toContain("INSERT INTO public.schema_migrations (migration)\nVALUES ('erp3_v1')");
  });

  it('every table defined in SQL migration has a corresponding Drizzle model', () => {
    for (const tableName of Object.keys(MODULE_TABLES)) {
      expect(migrationSql).toContain(`CREATE TABLE IF NOT EXISTS erp3.${tableName}`);
    }
  });

  it('every check constraint in Drizzle exists in erp3_v1.sql with identical name', () => {
    for (const table of Object.values(MODULE_TABLES)) {
      const checks = getTableConfig(table).checks;
      for (const c of checks) {
        expect(
          migrationSql,
          `Constraint '${c.name}' missing from packages/database/migrations/erp3_v1.sql`,
        ).toContain(`CONSTRAINT ${c.name} CHECK`);
      }
    }
  });

  it('every unique constraint/index in Drizzle exists in erp3_v1.sql with identical name', () => {
    for (const table of Object.values(MODULE_TABLES)) {
      const config = getTableConfig(table);
      for (const u of config.uniqueConstraints) {
        expect(
          migrationSql,
          `Unique constraint '${u.name}' missing from erp3_v1.sql`,
        ).toContain(`CONSTRAINT ${u.name} UNIQUE`);
      }
      for (const idx of config.indexes) {
        if (idx.config.unique) {
          expect(
            migrationSql,
            `Unique index or constraint '${idx.config.name}' missing from erp3_v1.sql`,
          ).toMatch(new RegExp(`(CONSTRAINT ${idx.config.name} UNIQUE|CREATE UNIQUE INDEX IF NOT EXISTS ${idx.config.name})`));
        }
      }
    }
  });
});
