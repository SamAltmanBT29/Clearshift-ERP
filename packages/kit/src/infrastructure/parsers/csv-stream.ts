import { Readable, Transform } from "node:stream";
import { createHash } from "node:crypto";
import { AppError } from "@cs/kernel";

export interface ParsedRawRow {
  sourceRow: number;
  payload: Record<string, string>;
  rowHash: string;
}

export interface CsvStreamOptions {
  maxBytes?: number; // default 50 MB per Section 4.4
  delimiter?: "," | ";";
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export async function parseCsvStream(
  inputStream: Readable,
  options: CsvStreamOptions = {}
): Promise<{
  rows: ParsedRawRow[];
  totalRows: number;
  fileHash: string;
  totalBytes: number;
}> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const hash = createHash("sha256");

  let totalBytes = 0;
  let buffer = "";
  let headers: string[] | null = null;
  let sourceRowCounter = 0;
  const rows: ParsedRawRow[] = [];

  const delimiter = options.delimiter ?? ",";

  return new Promise((resolve, reject) => {
    inputStream.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      hash.update(buf);

      if (totalBytes > maxBytes) {
        inputStream.destroy();
        reject(
          new AppError(
            "FILE_SIZE_LIMIT_EXCEEDED",
            `File size exceeds maximum allowed ceiling of ${maxBytes / (1024 * 1024)} MB`,
            413
          )
        );
        return;
      }

      buffer += buf.toString("utf-8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? ""; // keep incomplete remainder

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const cells = trimmed.split(delimiter).map((c) => c.replace(/^["']|["']$/g, "").trim());

        if (!headers) {
          headers = cells;
          continue;
        }

        sourceRowCounter++;
        const payload: Record<string, string> = {};
        for (let i = 0; i < headers.length; i++) {
          const headerName = headers[i] || `col_${i + 1}`;
          payload[headerName] = cells[i] ?? "";
        }

        const rowHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        rows.push({
          sourceRow: sourceRowCounter,
          payload,
          rowHash
        });
      }
    });

    inputStream.on("end", () => {
      // Process any remainder line
      if (buffer.trim() && headers) {
        sourceRowCounter++;
        const cells = buffer.trim().split(delimiter).map((c) => c.replace(/^["']|["']$/g, "").trim());
        const payload: Record<string, string> = {};
        for (let i = 0; i < headers.length; i++) {
          const headerName = headers[i] || `col_${i + 1}`;
          payload[headerName] = cells[i] ?? "";
        }
        const rowHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        rows.push({
          sourceRow: sourceRowCounter,
          payload,
          rowHash
        });
      }

      resolve({
        rows,
        totalRows: rows.length,
        fileHash: hash.digest("hex"),
        totalBytes
      });
    });

    inputStream.on("error", (err) => {
      reject(new AppError("CSV_PARSING_FAILED", err.message, 400));
    });
  });
}
