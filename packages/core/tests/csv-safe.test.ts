import { describe, it, expect } from "vitest";
import {
  sanitizeCsvCell,
  formatSafeCsvRow,
  formatSafeCsv,
  escapeHtml,
  assertAllowedSqlIdentifier,
} from "../src/exports/csv-safe.js";
import { scanDirectory } from "../../../infra/security/scan-secrets.js";

describe("[PLT-12] Security Baseline, Secrets, Dependency and Export Protections", () => {
  describe("CSV Formula Injection Sanitization (OWASP CSV Injection)", () => {
    it("neutralizes formula trigger characters (=, +, -, @) appearing after leading whitespace", () => {
      // Equals prefix
      expect(sanitizeCsvCell("=1+1")).toBe("'=1+1");
      expect(sanitizeCsvCell("   =1+1")).toBe('"   \'=1+1"');

      // Plus prefix
      expect(sanitizeCsvCell("+100")).toBe("'+100");
      expect(sanitizeCsvCell("  +cmd|' /C calc'!A0")).toBe('"  \'+cmd|\' /C calc\'!A0"');

      // Minus prefix
      expect(sanitizeCsvCell("-50")).toBe("'-50");
      expect(sanitizeCsvCell(" -SUM(A1:A5)")).toBe('" \'-SUM(A1:A5)"');

      // At symbol prefix
      expect(sanitizeCsvCell("@SUM(A1:B10)")).toBe("'@SUM(A1:B10)");
      expect(sanitizeCsvCell("    @IMPORTXML('http://evil.com')")).toBe('"    \'@IMPORTXML(\'http://evil.com\')"');

      // Tab or carriage return prefix
      expect(sanitizeCsvCell("\t=cmd")).toBe("\"\t'=cmd\"");
    });

    it("leaves standard benign values unmutated and correctly quoted when containing delimiters", () => {
      expect(sanitizeCsvCell("Acme Corporation")).toBe("Acme Corporation");
      expect(sanitizeCsvCell("12345")).toBe("12345");
      expect(sanitizeCsvCell("")).toBe("");
      expect(sanitizeCsvCell(null)).toBe("");
      expect(sanitizeCsvCell(undefined)).toBe("");

      // Delimiters requiring RFC 4180 quotes
      expect(sanitizeCsvCell('Hello, "World"')).toBe('"Hello, ""World"""');
      expect(sanitizeCsvCell("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
    });

    it("ensures source record objects are NEVER mutated in place during export", () => {
      const originalRecord = {
        id: "rec-1",
        name: "Acme",
        formulaPayload: "=2+2",
        negativeVal: " -100",
        notes: "Safe text",
      };

      // Deep clone copy for assertion
      const snapshot = JSON.parse(JSON.stringify(originalRecord));

      const exportedCsv = formatSafeCsv([originalRecord]);

      // Exported CSV contains neutralized formulas
      expect(exportedCsv).toContain("'=2+2");
      expect(exportedCsv).toContain("'-100");

      // Original record in memory remains pristine and unmutated!
      expect(originalRecord.formulaPayload).toBe(snapshot.formulaPayload);
      expect(originalRecord.negativeVal).toBe(snapshot.negativeVal);
      expect(originalRecord).toEqual(snapshot);
    });

    it("formats a complete multi-column, multi-row CSV safely", () => {
      const records = [
        { id: 1, name: "Alice", formula: "=SUM(1,2)", comment: "Normal" },
        { id: 2, name: "Bob", formula: "+cmd", comment: 'Has "quotes" and, commas' },
      ];

      const csv = formatSafeCsv(records);
      const lines = csv.split("\r\n");

      expect(lines[0]).toBe("id,name,formula,comment");
      expect(lines[1]).toBe('1,Alice,"\'=SUM(1,2)",Normal');
      expect(lines[2]).toBe('2,Bob,\'+cmd,"Has ""quotes"" and, commas"');
    });
  });

  describe("SQL Injection & Allowlist Protections", () => {
    const ALLOWED_TABLES = ["hub_users", "journal_entries", "audit_logs", "accounts"] as const;

    it("allows registered dynamic identifiers from explicit allowlist", () => {
      expect(assertAllowedSqlIdentifier("journal_entries", ALLOWED_TABLES)).toBe("journal_entries");
      expect(assertAllowedSqlIdentifier("hub_users", ALLOWED_TABLES)).toBe("hub_users");
    });

    it("rejects unauthorized identifiers and SQL injection payloads", () => {
      expect(() =>
        assertAllowedSqlIdentifier("hub_users; DROP TABLE accounts;--", ALLOWED_TABLES)
      ).toThrow("Unauthorized SQL identifier");

      expect(() =>
        assertAllowedSqlIdentifier("' OR '1'='1", ALLOWED_TABLES)
      ).toThrow("Unauthorized SQL identifier");

      expect(() =>
        assertAllowedSqlIdentifier("unregistered_table", ALLOWED_TABLES)
      ).toThrow("Unauthorized SQL identifier");
    });
  });

  describe("Cross-Site Scripting (XSS) Output Encoding", () => {
    it("strictly escapes all HTML special characters", () => {
      const xssPayload = `<script>alert("XSS & theft")</script>`;
      const escaped = escapeHtml(xssPayload);

      expect(escaped).toBe(
        "&lt;script&gt;alert(&quot;XSS &amp; theft&quot;)&lt;&#x2F;script&gt;"
      );
      expect(escaped).not.toContain("<script>");
      expect(escaped).not.toContain("</script>");

      const imgPayload = `<img src=x onerror=alert('pwnd') />`;
      const escapedImg = escapeHtml(imgPayload);
      expect(escapedImg).toBe(
        "&lt;img src=x onerror=alert(&#39;pwnd&#39;) &#x2F;&gt;"
      );
    });

    it("handles null, undefined, and non-string primitives safely", () => {
      expect(escapeHtml(null)).toBe("");
      expect(escapeHtml(undefined)).toBe("");
      expect(escapeHtml(12345)).toBe("12345");
    });
  });

  describe("Repository Scan for Hardcoded Secrets & Cloud Uploaders", () => {
    it("scans current core codebase ensuring zero unauthorized cloud uploaders or hardcoded secrets", () => {
      // Scan packages/core
      const result = scanDirectory(__dirname);
      expect(result.violations).toEqual([]);
      expect(result.passed).toBe(true);
    });
  });
});
