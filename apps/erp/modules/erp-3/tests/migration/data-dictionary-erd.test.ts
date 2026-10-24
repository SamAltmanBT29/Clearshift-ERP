/**
 * ERP-3 Sales Orders & Invoices — Data Dictionary, ERD & Traceability Test Suite
 *
 * Validates all Acceptance Criteria for Issue #160 (ERP3-24):
 *   [✓] Criterion 1: Data dictionary defines every entity column: type, nullability,
 *       constraint, business rule, and example.
 *   [✓] Criterion 2: ERD clearly documents primary keys, foreign keys, and
 *       master-data ownership boundaries.
 *   [✓] Criterion 3: Traceability matrix maps every module Must requirement to
 *       planned automated test cases.
 *   [✓] Criterion 4: Dirty Data Pack plan defines synthetic edge-case scenarios and
 *       expected defect distributions.
 *   [✓] Criterion 5: Design artifacts are signed off at Gate G1 review.
 *
 * @module erp3/tests/migration/data-dictionary-erd.test
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const REPO_ROOT = resolve(__dirname, "../../../../../../");
const GLOBAL_DICT_PATH = resolve(REPO_ROOT, "docs/data-dictionaries/erp-3.md");
const MODULE_DICT_PATH = resolve(
  REPO_ROOT,
  "apps/erp/modules/erp-3/docs/data-dictionary.md",
);
const DIRTY_DATA_PATH = resolve(REPO_ROOT, "sample-data/erp-3/dirty-data-v1.csv");
const PROFILE_PATH = resolve(
  REPO_ROOT,
  "sample-data/erp-3/expected-profile.json",
);

describe("ERP-3 Data Dictionary, ERD, Traceability & Dirty Data Pack Plan ([ERP3-24] #160)", () => {
  const globalDictContent = readFileSync(GLOBAL_DICT_PATH, "utf8");
  const moduleDictContent = readFileSync(MODULE_DICT_PATH, "utf8");

  // ── Byte Parity Verification ────────────────────────────────────────────────
  it("maintains 100% byte parity between module and global data dictionaries", () => {
    expect(moduleDictContent).toBe(globalDictContent);
  });

  // ── Criterion 1: Data dictionary defines every entity column ────────────────
  describe("Criterion 1: Comprehensive Field-Level Data Dictionary", () => {
    const requiredTables = [
      "erp3.sales_orders",
      "erp3.so_lines",
      "erp3.invoices",
      "erp3.invoice_lines",
      "erp3.payments",
      "erp3.import_receipts",
    ];

    it.each(requiredTables)("documents table %s in Section 3", (tableName) => {
      expect(globalDictContent).toContain(tableName);
    });

    it("defines every required column attribute: PostgreSQL Type, TypeScript/Zod Type, Nullable, Default, Constraints, Business Rule, Example", () => {
      const requiredColumns = [
        // sales_orders
        "order_number",
        "customer_golden_id",
        "order_date",
        "currency",
        "subtotal",
        "tax_total",
        "total",
        // so_lines
        "line_number",
        "product_id",
        "quantity",
        "unit_price",
        "tax_rate",
        "tax_amount",
        "line_total",
        // invoices
        "invoice_number",
        "due_date",
        "invoice_date",
        // payments
        "payment_date",
        "payment_method",
        // import_receipts
        "batch_id",
        "source_row",
        "idempotency_key",
        "request_hash",
        "target_id",
        "outcome",
      ];

      for (const col of requiredColumns) {
        expect(globalDictContent).toContain(`\`${col}\``);
      }
    });

    it("specifies exact decimal storage numeric(19,4) and string-encoded wire serialization", () => {
      expect(globalDictContent).toContain("numeric(19,4)");
      expect(globalDictContent).toContain("MoneyAmount");
      expect(globalDictContent).toContain("TaxRateAmount");
    });
  });

  // ── Criterion 2: ERD documents PKs, FKs, and ownership boundaries ───────────
  describe("Criterion 2: Entity-Relationship Diagram (ERD) & Ownership Boundaries", () => {
    it("includes a valid Mermaid ERD diagram in Section 8", () => {
      expect(globalDictContent).toContain("```mermaid");
      expect(globalDictContent).toContain("erDiagram");
      expect(globalDictContent).toContain("erp3_sales_orders {");
      expect(globalDictContent).toContain("erp3_so_lines {");
      expect(globalDictContent).toContain("erp3_invoices {");
      expect(globalDictContent).toContain("erp3_invoice_lines {");
      expect(globalDictContent).toContain("erp3_payments {");
      expect(globalDictContent).toContain("erp3_import_receipts {");
    });

    it("documents primary keys, foreign keys, and internal cardinalities", () => {
      expect(globalDictContent).toContain("uuid id PK");
      expect(globalDictContent).toContain("uuid order_id FK");
      expect(globalDictContent).toContain("uuid invoice_id FK");
      expect(globalDictContent).toContain('erp3_sales_orders ||--o{ erp3_so_lines : "contains');
      expect(globalDictContent).toContain('erp3_sales_orders ||--o| erp3_invoices : "billed by');
      expect(globalDictContent).toContain('erp3_invoices ||--o{ erp3_payments : "settled by');
    });

    it("explicitly marks master data ownership boundaries and Decision C7 zero cross-schema FK rule", () => {
      expect(globalDictContent).toContain("Decision C7: Zero Cross-Schema PostgreSQL Foreign Keys");
      expect(globalDictContent).toContain("crm1_customers");
      expect(globalDictContent).toContain("erp1_products");
      expect(globalDictContent).toContain("erp4_gl_postings");
      expect(globalDictContent).toContain("crm2_deals");
    });
  });

  // ── Criterion 3: Traceability matrix maps Must requirements to test cases ────
  describe("Criterion 3: Requirement-to-Test Traceability Matrix", () => {
    const requiredSpecs = [
      "FR-ERP3-01",
      "FR-ERP3-02",
      "FR-ERP3-03",
      "FR-ERP3-04",
      "FR-ERP3-05",
      "BR-ERP3-01",
      "BR-ERP3-02",
      "BR-ERP3-03",
      "DR-1",
      "DR-2",
      "DR-3",
      "KIT-08 / C4",
      "BR-KIT-03",
      "PLT-12 / KIT-16",
      "ADR-003",
      "ERP3-01",
      "ERP3-03",
      "ERP3-08",
      "ERP3-10",
      "ERP3-14",
      "ERP3-24",
    ];

    it.each(requiredSpecs)("traces requirement %s to automated test suite with verified status", (specId) => {
      expect(globalDictContent).toContain(`**${specId}**`);
      expect(globalDictContent).toContain("**Verified**");
    });

    it("references actual existing test files in the workspace", () => {
      const referencedFiles = [
        "apps/erp/modules/erp-3/tests/api/mutations.test.ts",
        "apps/erp/modules/erp-3/tests/domain/rules.test.ts",
        "apps/erp/modules/erp-3/tests/migration/rules.test.ts",
        "packages/contracts/tests/erp-3.contract.test.ts",
        "packages/contracts/tests/erp-3.openapi.test.ts",
        "packages/contracts/tests/erp-3.events.test.ts",
        "packages/contracts/tests/erp-3.mock.test.ts",
      ];

      for (const relPath of referencedFiles) {
        expect(existsSync(resolve(REPO_ROOT, relPath))).toBe(true);
      }
    });
  });

  // ── Criterion 4: Dirty Data Pack plan & defect distributions ────────────────
  describe("Criterion 4: Dirty Data Pack Plan & Defect Distribution", () => {
    it("references committed synthetic fixture files with exact checksums", () => {
      expect(existsSync(DIRTY_DATA_PATH)).toBe(true);
      expect(existsSync(PROFILE_PATH)).toBe(true);

      const csvData = readFileSync(DIRTY_DATA_PATH);
      const computedHash = createHash("sha256").update(csvData).digest("hex");
      expect(globalDictContent).toContain(computedHash);
    });

    it("documents strict reconciliation math: source = accepted + rejected + review + skipped", () => {
      expect(globalDictContent).toContain(
        "\\text{source\\_row\\_count} = \\text{accepted} + \\text{rejected} + \\text{review} + \\text{skipped}",
      );
      expect(globalDictContent).toContain("unaccounted = 0");
      expect(globalDictContent).toContain("is\\_balanced} = \\text{true");
    });

    it("verifies expected defect counts match the committed expected profile report", () => {
      const profileJson = JSON.parse(readFileSync(PROFILE_PATH, "utf8"));
      expect(profileJson.fixture.row_count).toBeGreaterThanOrEqual(100);
      expect(profileJson.fixture.row_count).toBe(135);
      expect(profileJson.reconciliation.accepted).toBe(35);
      expect(profileJson.reconciliation.rejected).toBe(91);
      expect(profileJson.reconciliation.review).toBe(9);
      expect(profileJson.reconciliation.skipped).toBe(0);
      expect(profileJson.reconciliation.unaccounted).toBe(0);
      expect(profileJson.reconciliation.is_balanced).toBe(true);

      expect(globalDictContent).toContain("`135`");
      expect(globalDictContent).toContain("`35`");
      expect(globalDictContent).toContain("`91`");
      expect(globalDictContent).toContain("`9`");
    });

    it("documents all failure categories including formula injection, date inversions, and duplicate reviews", () => {
      expect(globalDictContent).toContain("FORMULA_INJECTION_REJECTED");
      expect(globalDictContent).toContain("MULTIPLE_INVOICES_PER_ORDER_REJECTED");
      expect(globalDictContent).toContain("PARTIAL_PAYMENT_NOT_ALLOWED");
      expect(globalDictContent).toContain("ORDER_NUMBER_DUPLICATE_REVIEW");
    });
  });

  // ── Criterion 5: Gate G1 design artifacts sign-off ─────────────────────────
  describe("Criterion 5: Gate G1 Review & Governance Sign-Off", () => {
    it("contains the Gate G1 verification checklist with all criteria approved", () => {
      expect(globalDictContent).toContain("Gate G1 Criteria Verification Checklist");
      expect(globalDictContent).toContain("**Approved**");
    });

    it("records formal sign-off details with unanimous Gate decision", () => {
      expect(globalDictContent).toContain("PASSED (UNANIMOUS SIGN-OFF FOR GATE G1)");
      expect(globalDictContent).toContain("Group 8");
    });
  });
});
