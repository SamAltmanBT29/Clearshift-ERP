import { z } from 'zod';

/**
 * Standard HTTP Status Codes as mandated by PLT-04 constraints.
 * 400: invalid request
 * 401: unauthenticated
 * 403: forbidden
 * 404: not found
 * 409: conflicts
 * 413: upload limit (payload too large)
 * 422: business rule (unprocessable entity)
 * 429: rate limit (too many requests)
 * 500: unexpected (internal server error)
 */
export const HttpStatusCodes = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
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
 * Standard Application Error Codes.
 */
export const StandardErrorCodes = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const;

export type StandardErrorCode = (typeof StandardErrorCodes)[keyof typeof StandardErrorCodes] | string;

/**
 * Field-level Error Detail Schema.
 */
export const ErrorDetailSchema = z.object({
  field: z.string().optional(),
  message: z.string(),
  code: z.string().optional(),
}).passthrough();

export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

/**
 * Direct Error Envelope Schema ({ code, message, details, correlation_id }).
 */
export const DirectErrorEnvelopeSchema = z.object({
  code: z.string().min(1, 'Error code is required'),
  message: z.string().min(1, 'Error message is required'),
  details: z.union([
    z.array(ErrorDetailSchema),
    z.record(z.string(), z.unknown()),
    z.unknown(),
  ]).optional(),
  correlation_id: z.string().optional(),
  correlationId: z.string().optional(),
});

/**
 * Nested Error Envelope Schema ({ error: { code, message, details, correlation_id } }).
 */
export const NestedErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1, 'Error code is required'),
    message: z.string().min(1, 'Error message is required'),
    details: z.unknown().optional(),
    correlation_id: z.string().optional(),
    correlationId: z.string().optional(),
  }),
});

/**
 * Universal Error Envelope Schema ({ code, message, details, correlation_id } or { error: { ... } }).
 * Mandated by PLT-04: every error response includes stable code, simple message, safe details and correlation ID.
 */
export const ErrorEnvelopeSchema = z.union([
  DirectErrorEnvelopeSchema,
  NestedErrorEnvelopeSchema,
]);

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type DirectErrorEnvelope = z.infer<typeof DirectErrorEnvelopeSchema>;
export type NestedErrorEnvelope = z.infer<typeof NestedErrorEnvelopeSchema>;

/**
 * Helper to construct a typed ErrorEnvelope (direct format).
 */
export function createErrorEnvelope(params: {
  code: string;
  message: string;
  details?: unknown;
  correlationId?: string;
  correlation_id?: string;
}): DirectErrorEnvelope {
  const corrId = params.correlationId ?? params.correlation_id;
  return {
    code: params.code,
    message: params.message,
    details: params.details,
    correlation_id: corrId,
    correlationId: corrId,
  };
}

/**
 * Bounded Pagination Constraints (Non-Negotiable: max pageSize 100).
 */
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE, `pageSize cannot exceed ${MAX_PAGE_SIZE}`).default(DEFAULT_PAGE_SIZE),
  search: z.string().trim().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc').optional(),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Cursor-based pagination for large logs and streams.
 */
export const CursorPaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type CursorPaginationQuery = z.infer<typeof CursorPaginationQuerySchema>;

/**
 * Pagination Metadata Schema.
 */
export const PaginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
  hasNextPage: z.boolean().optional(),
  hasPrevPage: z.boolean().optional(),
});

export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/**
 * Helper to compute pagination metadata.
 */
export function computePaginationMeta(params: {
  page: number;
  pageSize: number;
  total: number;
}): PaginationMeta {
  const totalPages = Math.ceil(params.total / params.pageSize) || 0;
  return {
    page: params.page,
    pageSize: params.pageSize,
    total: params.total,
    totalPages,
    hasNextPage: params.page < totalPages,
    hasPrevPage: params.page > 1,
  };
}

/**
 * Generic Paginated Response Schema factory.
 */
export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    meta: PaginationMetaSchema,
  });
}
