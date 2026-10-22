import { z } from 'zod';

/**
 * Standard HTTP Status Codes mandated by ClearShift Architecture (PLT-04)
 */
export const HttpStatusCodes = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export type HttpStatusCode = (typeof HttpStatusCodes)[keyof typeof HttpStatusCodes];

/**
 * Standard Machine-Readable Error Codes
 */
export const StandardErrorCodes = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  UNEXPECTED_ERROR: 'UNEXPECTED_ERROR',
} as const;

export const StandardErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNPROCESSABLE_ENTITY',
  'BUSINESS_RULE_VIOLATION',
  'TOO_MANY_REQUESTS',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'UNEXPECTED_ERROR',
]);

export type StandardErrorCode = z.infer<typeof StandardErrorCodeSchema>;

/**
 * Standard Field-Level Error Detail Schema
 */
export const ErrorDetailSchema = z.object({
  field: z.string().optional(),
  message: z.string().min(1, 'Error detail message is required'),
  code: z.string().optional(),
});

export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

/**
 * Standard Flat Error Envelope Schema (PLT-04 / @cs/kernel)
 * Canonical format: { code, message, details, correlation_id }
 */
export const FlatErrorEnvelopeSchema = z.object({
  code: z.string().min(1, 'Error code is required'),
  message: z.string().min(1, 'Error message is required'),
  details: z
    .union([z.array(ErrorDetailSchema), z.record(z.unknown()), z.unknown()])
    .optional()
    .default([]),
  correlation_id: z.string().optional(),
});

/**
 * Nested Error Envelope Schema for module-level compatibility ({ error: { code, message, details } })
 */
export const NestedErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1, 'Error code is required'),
    message: z.string().min(1, 'Error message is required'),
    details: z.unknown().optional(),
  }),
  correlation_id: z.string().optional(),
});

/**
 * Unified Error Envelope Schema: accepts canonical flat envelope or nested module format
 */
export const ErrorEnvelopeSchema = z.union([
  FlatErrorEnvelopeSchema,
  NestedErrorEnvelopeSchema,
]);

export type ErrorEnvelope = z.infer<typeof FlatErrorEnvelopeSchema>;

/**
 * Helper to build a canonical FlatErrorEnvelope response
 */
export function createErrorEnvelope(
  code: string,
  message: string,
  details: unknown = [],
  correlationId?: string
): ErrorEnvelope {
  return {
    code,
    message,
    details,
    ...(correlationId ? { correlation_id: correlationId } : {}),
  };
}

/**
 * Bounded Pagination Query Schema (Page/PageSize/Limit)
 * Non-negotiable constraint: pageSize and limit must be integers capped at 100
 */
export const BasePaginationQuerySchema = z.object({
  page: z.coerce
    .number()
    .int({ message: 'page must be an integer' })
    .min(1, { message: 'page must be >= 1' })
    .default(1),
  pageSize: z.coerce
    .number()
    .int({ message: 'pageSize must be an integer' })
    .min(1, { message: 'pageSize must be >= 1' })
    .max(100, { message: 'pageSize cannot exceed 100' })
    .optional(),
  limit: z.coerce
    .number()
    .int({ message: 'limit must be an integer' })
    .min(1, { message: 'limit must be >= 1' })
    .max(100, { message: 'limit cannot exceed 100' })
    .optional(),
});

export type BasePaginationQuery = z.infer<typeof BasePaginationQuerySchema>;

/**
 * Standard Paginated Query Schema with default pageSize of 20
 */
export const StandardPaginationQuerySchema = BasePaginationQuerySchema.extend({
  pageSize: z.coerce
    .number()
    .int({ message: 'pageSize must be an integer' })
    .min(1, { message: 'pageSize must be >= 1' })
    .max(100, { message: 'pageSize cannot exceed 100' })
    .default(20),
});

export type StandardPaginationQuery = z.infer<typeof StandardPaginationQuerySchema>;

/**
 * Cursor Pagination Query Schema for large audit logs and streams
 */
export const CursorPaginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce
    .number()
    .int({ message: 'limit must be an integer' })
    .min(1, { message: 'limit must be >= 1' })
    .max(100, { message: 'limit cannot exceed 100' })
    .default(50),
  direction: z.enum(['forward', 'backward']).default('forward'),
});

export type CursorPaginationQuery = z.infer<typeof CursorPaginationQuerySchema>;

/**
 * Factory for standard paginated list response schema
 */
export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative().optional(),
  });
}

/**
 * Factory for standard cursor-paginated response schema
 */
export function createCursorPaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable().optional(),
    prevCursor: z.string().nullable().optional(),
    hasMore: z.boolean(),
  });
}

/**
 * Standard Health Check Response Schema
 */
export const HealthStatusSchema = z.enum(['ok', 'degraded', 'down']);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const HealthResponseSchema = z.object({
  status: HealthStatusSchema,
  module: z.string().min(1),
  version: z.string().min(1),
  timestamp: z.string().datetime().optional(),
  dependencies: z
    .record(
      z.object({
        status: HealthStatusSchema,
        latencyMs: z.number().optional(),
        message: z.string().optional(),
      })
    )
    .optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
