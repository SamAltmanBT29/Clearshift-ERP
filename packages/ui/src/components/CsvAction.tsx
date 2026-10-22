import React from "react";

export interface CsvExportButtonProps {
  filename?: string;
  onExport: () => Promise<string | Record<string, any>[]> | string | Record<string, any>[];
  label?: string;
  isLoading?: boolean;
  className?: string;
  disabled?: boolean;
}

/**
 * Sanitizes cell values to prevent CSV formula injection (OWASP CSV Injection).
 * Cells starting with =, +, -, @, or tab are prefixed with a single quote.
 */
export function sanitizeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return "";
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Escape double quotes and enclose in quotes if comma or quote present
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateCsvContent(records: Record<string, any>[]): string {
  if (records.length === 0) return "";
  const headers = Object.keys(records[0]!);
  const headerLine = headers.map(sanitizeCsvCell).join(",");
  const rows = records.map((record) =>
    headers.map((h) => sanitizeCsvCell(record[h])).join(",")
  );
  return [headerLine, ...rows].join("\n");
}

export const CsvExportButton: React.FC<CsvExportButtonProps> = ({
  filename = "export.csv",
  onExport,
  label = "Export CSV",
  isLoading = false,
  className = "",
  disabled = false
}) => {
  const [exporting, setExporting] = React.useState(false);

  const handleExport = async () => {
    try {
      setExporting(true);
      const data = await onExport();
      let csvString: string;
      if (typeof data === "string") {
        csvString = data;
      } else {
        csvString = generateCsvContent(data);
      }

      // Download file in browser if DOM environment
      if (typeof window !== "undefined" && window.document) {
        const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(false);
    }
  };

  const isBusy = isLoading || exporting;

  return (
    <button
      type="button"
      aria-label={label}
      aria-busy={isBusy}
      disabled={disabled || isBusy}
      onClick={handleExport}
      className={`cs-csv-action inline-flex items-center gap-2 px-3 py-1.5 rounded border border-[var(--cs-border)] bg-[var(--cs-bg)] text-sm font-medium text-[var(--cs-text)] hover:bg-[var(--cs-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className}`}
    >
      <span aria-hidden="true">📥</span>
      <span>{isBusy ? "Exporting..." : label}</span>
    </button>
  );
};
