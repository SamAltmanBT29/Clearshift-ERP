import { AsyncLocalStorage } from "node:async_hooks";

export interface CorrelationContext {
  correlationId: string;
  module?: string | undefined;
  operation?: string | undefined;
  actor?: string | undefined;
}

const asyncLocalStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Returns the active correlation ID from async storage, or generates a new UUID
 */
export function getCorrelationId(): string {
  const store = asyncLocalStorage.getStore();
  return store?.correlationId ?? crypto.randomUUID();
}

/**
 * Returns the complete active correlation context
 */
export function getCorrelationContext(): CorrelationContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Executes a callback within the context of a specific correlation ID and module context
 */
export function runWithCorrelationContext<T>(
  context: CorrelationContext,
  fn: () => T
): T {
  return asyncLocalStorage.run(context, fn);
}

/**
 * Helper to extract or generate correlation ID from HTTP request headers
 */
export function extractCorrelationId(headers: Record<string, string | string[] | undefined>): string {
  const headerVal =
    headers["x-correlation-id"] ||
    headers["x-request-id"] ||
    headers["correlation-id"] ||
    headers["request-id"];

  if (Array.isArray(headerVal)) {
    return headerVal[0] && headerVal[0].trim() !== "" ? headerVal[0] : crypto.randomUUID();
  }

  if (typeof headerVal === "string" && headerVal.trim() !== "") {
    return headerVal.trim();
  }

  return crypto.randomUUID();
}
