import { describe, it, expect } from "vitest";
import {
  profileDataset,
  exportProfileReportToCsv,
  escapeCsvCell,
  computeSha256,
  type ProfilerConfig,
} from "../src/domain/profiler.js";

describe("Migration Kit Shared Profiler (KIT-03)", () => {
  const sampleRows: Record<string, string>[] = [
    { row_id: "1", record_type: "vendor", name: "Acme Corp", tax_id: "TAX-001", email: "acme@example.com" },
    { row_id: "2", record_type: "vendor", name: "Beta LLC", tax_id: "TAX-002", email: "invalid-email" },
    { row_id: "3", record_type: "vendor", name: "Acme Duplicate", tax_id: "TAX-001", email: "dup@example.com" },
    { row_id: "4", record_type: "vendor", name: "", tax_id: "TAX-003", email: "test@example.com" },
    { row_id: "5", record_type: "vendor", name: "Gamma Inc", tax_id: "", email: "" },
  ];

  const config: ProfilerConfig = {
    columns: [
      {
        column: "name",
        label: "Vendor Name",
        required: true,
      },
      {
        column: "tax_id",
        label: "Tax ID",
        required: true,
        formatValidator: (v) => /^TAX-\d{3}$/.test(v),
      },
      {
        column: "email",
        label: "Email Address",
        required: false,
        formatValidator: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      },
    ],
    duplicateKeys: [
      {
        name: "vendor_tax_id",
        label: "Vendor Tax ID",
        extractKey: (r) => (r.tax_id ? r.tax_id.trim() : null),
      },
    ],
  };

  it("accurately computes total rows, null counts, distinct values, and invalid format rates", () => {
    const report = profileDataset(sampleRows, config);

    expect(report.totalRows).toBe(5);

    // name: 1 empty, 4 populated, 4 distinct, 1 invalid (since required and empty)
    const nameCol = report.columns["name"];
    expect(nameCol.nullCount).toBe(1);
    expect(nameCol.populatedCount).toBe(4);
    expect(nameCol.distinctCount).toBe(4);
    expect(nameCol.invalidFormatCount).toBe(1);
    expect(nameCol.invalidFormatRate).toBe(20.0);

    // tax_id: 1 empty, 4 populated, 3 distinct values ("TAX-001", "TAX-002", "TAX-003")
    const taxCol = report.columns["tax_id"];
    expect(taxCol.nullCount).toBe(1);
    expect(taxCol.populatedCount).toBe(4);
    expect(taxCol.distinctCount).toBe(3);
    // 1 empty (required) -> 1 invalid
    expect(taxCol.invalidFormatCount).toBe(1);

    // email: 1 empty, 4 populated, 4 distinct, 1 invalid format ("invalid-email")
    const emailCol = report.columns["email"];
    expect(emailCol.nullCount).toBe(1);
    expect(emailCol.populatedCount).toBe(4);
    expect(emailCol.invalidFormatCount).toBe(1);
    expect(emailCol.invalidFormatRate).toBe(20.0);
  });

  it("detects exact duplicate candidate groups accurately", () => {
    const report = profileDataset(sampleRows, config);
    const taxDup = report.exactDuplicates["vendor_tax_id"];

    expect(taxDup).toBeDefined();
    expect(taxDup.candidateCount).toBe(1);
    expect(taxDup.groups).toHaveLength(1);
    expect(taxDup.groups[0].key).toBe("TAX-001");
    expect(taxDup.groups[0].occurrences).toBe(2);
    expect(taxDup.groups[0].rowIds).toEqual(["1", "3"]);
  });

  it("preserves non-destructive source data immutability", () => {
    const originalJson = JSON.stringify(sampleRows);
    const report = profileDataset(sampleRows, config, originalJson);

    expect(report.isNonDestructive).toBe(true);
    expect(report.sha256).toBe(computeSha256(originalJson));
    expect(JSON.stringify(sampleRows)).toBe(originalJson);
  });

  it("exports formula-safe CSV data health report preventing spreadsheet formula injection", () => {
    const report = profileDataset(sampleRows, config);
    const csv = exportProfileReportToCsv(report);

    expect(csv).toContain("## Section 1: Column Quality Metrics");
    expect(csv).toContain("## Section 2: Exact Duplicate Candidate Groups");
    expect(csv).toContain("TAX-001");

    // Test OWASP formula cell escaping
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("+44123456")).toBe("'+44123456");
    expect(escapeCsvCell("-500")).toBe("'-500");
    expect(escapeCsvCell("@admin")).toBe("'@admin");
    expect(escapeCsvCell("\tmalicious")).toBe("'\tmalicious");
  });
});
