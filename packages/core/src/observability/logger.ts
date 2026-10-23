import { getCorrelationId, getCorrelationContext } from "./correlation.js";
import { redactSensitiveData, redactErrorMessage } from "../logging/redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  operation: string;
  correlation_id: string;
  message: string;
  error_code?: string | undefined;
  details?: unknown | undefined;
  duration_ms?: number | undefined;
}

export type LogSink = (entry: LogEntry) => void;

let customSink: LogSink | null = null;

export function setLogSink(sink: LogSink | null): void {
  customSink = sink;
}

export class StructuredLogger {
  constructor(private moduleName: string) {}

  private write(
    level: LogLevel,
    operation: string,
    message: string,
    extra?: {
      error_code?: string | undefined;
      details?: unknown | undefined;
      duration_ms?: number | undefined;
      error?: unknown | undefined;
      correlation_id?: string | undefined;
    }
  ): LogEntry {
    const context = getCorrelationContext();
    const explicitCorrelationId =
      extra?.correlation_id ??
      (extra?.details && typeof extra.details === "object" && ("correlation_id" in extra.details || "correlationId" in extra.details)
        ? (extra.details as any).correlation_id || (extra.details as any).correlationId
        : undefined);
    const correlationId = explicitCorrelationId ?? context?.correlationId ?? getCorrelationId();
    const safeDetails = extra?.details ? redactSensitiveData(extra.details) : undefined;
    const safeError = extra?.error ? redactErrorMessage(extra.error) : undefined;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.moduleName,
      operation,
      correlation_id: correlationId,
      message: redactSensitiveData(message),
      ...(extra?.error_code ? { error_code: extra.error_code } : {}),
      ...(safeDetails ? { details: safeDetails } : {}),
      ...(safeError ? { details: { ...(safeDetails as object), error: safeError } } : {}),
      ...(extra?.duration_ms !== undefined ? { duration_ms: extra.duration_ms } : {}),
    };

    if (customSink) {
      customSink(entry);
    } else {
      // In production/CLI, output JSON
      const json = JSON.stringify(entry);
      if (level === "error") {
        console.error(json);
      } else if (level === "warn") {
        console.warn(json);
      } else {
        console.log(json);
      }
    }

    return entry;
  }

  info(operation: string, message: string, details?: unknown): LogEntry {
    return this.write("info", operation, message, { details });
  }

  warn(operation: string, message: string, details?: unknown, errorCode?: string): LogEntry {
    return this.write("warn", operation, message, { details, error_code: errorCode });
  }

  error(
    operation: string,
    message: string,
    error?: unknown,
    errorCode?: string,
    details?: unknown
  ): LogEntry {
    return this.write("error", operation, message, { error, error_code: errorCode, details });
  }

  debug(operation: string, message: string, details?: unknown): LogEntry {
    return this.write("debug", operation, message, { details });
  }
}

export function createLogger(moduleName: string): StructuredLogger {
  return new StructuredLogger(moduleName);
}
