import { describe, it, expect } from "vitest";
import {
  cleanTextWhitespace,
  cleanControlCharacters,
  cleanProperName,
  cleanEmail,
  cleanPhone,
  cleanIsoDate,
  cleanCurrencyDecimal,
  cleanDataset,
  exportFieldAuditCsv,
  V1_CLEANING_RULES,
  type CleanerConfig,
} from "../src/domain/cleaner.js";

describe("ClearShift Migration Kit — Shared Cleaner & Audit Domain (KIT-04)", () => {
  describe("1. Standard Cleaner Functions (AC1)", () => {
    it("trims and collapses whitespace (RL-TEXT-01)", () => {
      expect(cleanTextWhitespace("   Cash   on   Hand   ")).toBe("Cash on Hand");
      expect(cleanTextWhitespace("1010-CASH ")).toBe("1010-CASH");
    });

    it("removes control characters (RL-TEXT-02)", () => {
      const contaminated = "Cash\x00\x08on\u200BHand";
      expect(cleanControlCharacters(contaminated)).toBe("CashonHand");
    });

    it("proper-cases names and preserves special particles (RL-NAME-01)", () => {
      expect(cleanProperName("john smith")).toBe("John Smith");
      expect(cleanProperName("o'brien")).toBe("O'Brien");
      expect(cleanProperName("mcdonald")).toBe("McDonald");
    });

    it("normalizes and validates emails (RL-EMAIL-01)", () => {
      const valid = cleanEmail("  USER@Example.COM  ");
      expect(valid.cleaned).toBe("user@example.com");
      expect(valid.isValid).toBe(true);

      const invalid = cleanEmail("bad-email@no-domain");
      expect(invalid.isValid).toBe(false);
    });

    it("normalizes phone numbers and adds country code if 10 digits (RL-PHONE-01)", () => {
      expect(cleanPhone("(987) 654-3210", "+91")).toBe("+919876543210");
      expect(cleanPhone("+1-800-555-0199")).toBe("+18005550199");
    });

    it("coerces dates to ISO 8601 (RL-DATE-01)", () => {
      const ymdSlash = cleanIsoDate("2026/04/15");
      expect(ymdSlash.cleaned).toBe("2026-04-15");
      expect(ymdSlash.isValid).toBe(true);

      const dmy = cleanIsoDate("15/04/2026", "DD-MM-YYYY");
      expect(dmy.cleaned).toBe("2026-04-15");
      expect(dmy.isValid).toBe(true);

      const invalid = cleanIsoDate("2026-02-31");
      expect(invalid.isValid).toBe(false);
    });

    it("cleans currency and decimal amounts (RL-CURRENCY-01)", () => {
      const formatted = cleanCurrencyDecimal(" $ 150,000.50 ");
      expect(formatted.cleaned).toBe("150000.50");
      expect(formatted.isValid).toBe(true);

      const negative = cleanCurrencyDecimal("-₹20,000.00");
      expect(negative.cleaned).toBe("-20000.00");
      expect(negative.isValid).toBe(true);
    });
  });

  describe("2. Field-Level Change Audit Trail & Rejections (AC2 & AC3)", () => {
    interface TestVendorRow {
      row_id: string;
      name: string;
      email: string;
      tax_id: string;
      phone: string;
    }

    const testRows: TestVendorRow[] = [
      { row_id: "1", name: "  acme   corp  ", email: " INFO@ACME.COM ", tax_id: "TAX-123", phone: "9876543210" },
      { row_id: "2", name: "", email: "valid@test.com", tax_id: "TAX-456", phone: "+911234567890" },
      { row_id: "3", name: "Clean Name", email: "clean@test.com", tax_id: "TAX-789", phone: "+911234567890" },
    ];

    const testConfig: CleanerConfig = {
      sourceRowField: "row_id",
      fields: [
        {
          field: "name",
          required: true,
          clean: (val, _row, enabled) => {
            const audits = [];
            let cleaned = val;
            if (enabled.has("RL-TEXT-01")) {
              const trimmed = cleanTextWhitespace(val);
              if (trimmed !== val) {
                audits.push({ ruleId: "RL-TEXT-01", original: val, cleaned: trimmed });
                cleaned = trimmed;
              }
            }
            if (enabled.has("RL-NAME-01") && cleaned) {
              const proper = cleanProperName(cleaned);
              if (proper !== cleaned) {
                audits.push({ ruleId: "RL-NAME-01", original: cleaned, cleaned: proper });
                cleaned = proper;
              }
            }
            if (!cleaned) {
              return {
                cleaned,
                audits,
                error: { ruleId: "RL-REQ-01", reasonCode: "NAME_REQUIRED", message: "Name is required" },
              };
            }
            return { cleaned, audits };
          },
        },
        {
          field: "email",
          required: false,
          clean: (val, _row, enabled) => {
            const audits = [];
            let cleaned = val;
            if (enabled.has("RL-EMAIL-01")) {
              const res = cleanEmail(val);
              if (res.cleaned !== val) {
                audits.push({ ruleId: "RL-EMAIL-01", original: val, cleaned: res.cleaned });
                cleaned = res.cleaned;
              }
            }
            return { cleaned, audits };
          },
        },
        {
          field: "phone",
          required: false,
          clean: (val, _row, enabled) => {
            const audits = [];
            let cleaned = val;
            if (enabled.has("RL-PHONE-01")) {
              const res = cleanPhone(val, "+91");
              if (res !== val) {
                audits.push({ ruleId: "RL-PHONE-01", original: val, cleaned: res });
                cleaned = res;
              }
            }
            return { cleaned, audits };
          },
        },
      ],
    };

    it("accurately classifies row outcomes: new, cleaned, rejected", () => {
      const result = cleanDataset(testRows, testConfig);

      expect(result.totalRows).toBe(3);
      expect(result.cleanedCount).toBe(1);
      expect(result.rejectedCount).toBe(1);
      expect(result.newCount).toBe(1);

      // Row 1: cleaned
      const r1 = result.rows[0]!;
      expect(r1.outcome).toBe("cleaned");
      expect(r1.cleanedData.name).toBe("Acme Corp");
      expect(r1.cleanedData.email).toBe("info@acme.com");
      expect(r1.cleanedData.phone).toBe("+919876543210");
      expect(r1.audits.length).toBeGreaterThan(0);

      // Row 2: rejected
      const r2 = result.rows[1]!;
      expect(r2.outcome).toBe("rejected");
      expect(r2.rejections[0]?.reasonCode).toBe("NAME_REQUIRED");

      // Row 3: new (clean as-is)
      const r3 = result.rows[2]!;
      expect(r3.outcome).toBe("new");
      expect(r3.audits.length).toBe(0);
    });

    it("records every modified value in field-level audit trail (AC2)", () => {
      const result = cleanDataset(testRows, testConfig);

      expect(result.audits.length).toBeGreaterThan(0);
      const nameAudit = result.audits.find((a) => a.sourceRow === "1" && a.fieldName === "name" && a.ruleId === "RL-TEXT-01");
      expect(nameAudit).toBeDefined();
      expect(nameAudit?.originalValue).toBe("  acme   corp  ");
      expect(nameAudit?.cleanedValue).toBe("acme corp");
    });

    it("exports field-level audit trail to formula-safe CSV", () => {
      const result = cleanDataset(testRows, testConfig);
      const csv = exportFieldAuditCsv(result.audits);

      expect(csv).toContain("Source Row,Field Name,Original Value,Cleaned Value,Rule ID,Timestamp");
      expect(csv).toContain("RL-TEXT-01");
      expect(csv).toContain("RL-EMAIL-01");
    });

    it("respects rule toggles per FR-CL-05", () => {
      const toggledConfig: CleanerConfig = {
        ...testConfig,
        enabledRuleIds: ["RL-TEXT-01"], // Only whitespace trimming, disable proper-case and email
      };

      const result = cleanDataset(testRows, toggledConfig);
      const r1 = result.rows[0]!;
      // Email should NOT be cleaned because RL-EMAIL-01 is toggled off
      expect(r1.cleanedData.email).toBe(" INFO@ACME.COM ");
      // Name trimmed but not title-cased
      expect(r1.cleanedData.name).toBe("acme corp");
    });
  });
});
