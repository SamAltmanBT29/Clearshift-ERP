/**
 * ERP-4 Finance & Accounting — Public API Contract Types
 *
 * These Zod schemas are the single source of truth for:
 *   - Request/response validation (Fastify + Zod)
 *   - OpenAPI spec generation (fastify-zod or zod-openapi)
 *   - TypeScript type inference (no separate type files needed)
 *
 * Module API base: /api/v1/erp-finance
 *
 * @module contracts/erp-4
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────────

/** ISO 4217 currency code — exactly 3 uppercase letters. */
export const CurrencyCode = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 currency code (e.g. INR, USD)');

/** UUID v4 format. */
export const UuidSchema = z.string().uuid('Must be a valid UUID v4');

/** Monetary amount: string-encoded decimal with up to 4 decimal places. */
export const MoneyAmount = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'Amount must be a non-negative decimal with up to 4 decimal places');

/** Fiscal period label: YYYY-MM format. */
export const PeriodLabel = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be in YYYY-MM format');

// ─────────────────────────────────────────────────────────────────────────────
// Enum schemas
// ─────────────────────────────────────────────────────────────────────────────

export const AccountTypeEnum = z.enum(['asset', 'liability', 'income', 'expense']);
export type AccountType = z.infer<typeof AccountTypeEnum>;

export const JournalEntryStatusEnum = z.enum(['draft', 'posted', 'reversed', 'voided']);
export type JournalEntryStatus = z.infer<typeof JournalEntryStatusEnum>;

export const PeriodStatusEnum = z.enum(['open', 'soft_closed', 'locked']);
export type PeriodStatus = z.infer<typeof PeriodStatusEnum>;

// ─────────────────────────────────────────────────────────────────────────────
// Account schemas
// GET /api/v1/erp-finance/accounts
// POST /api/v1/erp-finance/accounts (seed/admin/editor only)
// ─────────────────────────────────────────────────────────────────────────────

/** Response shape for a single Account. */
export const AccountSchema = z.object({
  id: UuidSchema,
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(255),
  type: AccountTypeEnum,
  currency_code: CurrencyCode,
  parent_id: UuidSchema.nullable(),
  description: z.string().max(2000).nullable(),
  is_active: z.boolean(),
  is_posting_account: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Account = z.infer<typeof AccountSchema>;

/** POST /api/v1/erp-finance/accounts — request body. */
export const CreateAccountRequestSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'Code must be alphanumeric with hyphens/underscores'),
  name: z.string().min(1).max(255),
  type: AccountTypeEnum,
  currency_code: CurrencyCode.default('INR'),
  parent_id: UuidSchema.optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  is_posting_account: z.boolean().default(true),
  idempotency_key: z.string().max(128).optional().nullable(),
  batch_id: UuidSchema.optional().nullable(),
  source_row: z.number().int().nonnegative().optional().nullable(),
});
export type CreateAccountRequest = z.infer<typeof CreateAccountRequestSchema>;

/** PATCH /api/v1/erp-finance/accounts/:id — request body. */
export const UpdateAccountRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  is_active: z.boolean().optional(),
  is_posting_account: z.boolean().optional(),
  parent_id: UuidSchema.optional().nullable(),
});
export type UpdateAccountRequest = z.infer<typeof UpdateAccountRequestSchema>;

/** Common URL ID parameter schema. */
export const IdParamSchema = z.object({
  id: UuidSchema,
});
export type IdParam = z.infer<typeof IdParamSchema>;

/** Generic pagination query parameters with hard cap of 100. */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page must be greater than or equal to 1').default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize must be greater than or equal to 1')
    .max(100, 'pageSize cannot exceed 100')
    .default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** GET /api/v1/erp-finance/accounts — query params. */
export const AccountListQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page must be greater than or equal to 1').default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize must be greater than or equal to 1')
    .max(100, 'pageSize cannot exceed 100')
    .default(20),
  search: z.string().trim().max(100).optional(),
  type: AccountTypeEnum.optional(),
  is_active: z
    .union([
      z.boolean(),
      z.enum(['true', 'false']).transform((v) => v === 'true'),
    ])
    .optional(),
  currency_code: CurrencyCode.optional(),
});
export type AccountListQuery = z.infer<typeof AccountListQuerySchema>;

/** GET /api/v1/erp-finance/accounts — response wrapper with bounded paging metadata. */
export const AccountListResponseSchema = z.object({
  data: z.array(AccountSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().default(20),
  totalPages: z.number().int().nonnegative().default(1),
});
export type AccountListResponse = z.infer<typeof AccountListResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Journal Entry schemas
// GET /api/v1/erp-finance/journal-entries
// GET /api/v1/erp-finance/journal-entries/:id
// POST /api/v1/erp-finance/journal-entries (creates draft)
// POST /api/v1/erp-finance/journal-entries/:id/post
// POST /api/v1/erp-finance/journal-entries/:id/reverse
// ─────────────────────────────────────────────────────────────────────────────

/** Response shape for a Journal Line within an entry. */
export const JournalLineSchema = z.object({
  id: UuidSchema,
  journal_entry_id: UuidSchema,
  account_id: UuidSchema,
  debit_amount: z.string(),  // NUMERIC returned as string from pg
  credit_amount: z.string(),
  line_narration: z.string().max(255).nullable(),
  department_ref: z.string().max(64).nullable(),
  created_at: z.string().datetime(),
});
export type JournalLine = z.infer<typeof JournalLineSchema>;

/** Response shape for a Journal Entry (with embedded lines). */
export const JournalEntrySchema = z.object({
  id: UuidSchema,
  entry_number: z.string().min(1).max(64),
  period_id: UuidSchema,
  posting_date: z.string().date(),
  status: JournalEntryStatusEnum,
  description: z.string().min(1),
  currency_code: CurrencyCode,
  source_reference: z.string().max(128).nullable(),
  idempotency_key: z.string().max(128).nullable(),
  created_by_user_id: UuidSchema,
  posted_by_user_id: UuidSchema.nullable(),
  posted_at: z.string().datetime().nullable(),
  reversed_by_entry_id: UuidSchema.nullable(),
  lines: z.array(JournalLineSchema),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

/** Request shape for a single line when creating a journal entry. */
export const CreateJournalLineRequestSchema = z
  .object({
    account_id: UuidSchema,
    debit_amount: MoneyAmount.default('0.0000'),
    credit_amount: MoneyAmount.default('0.0000'),
    line_narration: z.string().max(255).optional().nullable(),
    department_ref: z.string().max(64).optional().nullable(),
  })
  .refine(
    (line) => {
      const debit = parseFloat(line.debit_amount);
      const credit = parseFloat(line.credit_amount);
      // At least one must be non-zero
      if (debit <= 0 && credit <= 0) return false;
      // Cannot be both
      if (debit > 0 && credit > 0) return false;
      return true;
    },
    {
      message:
        'Each line must have exactly one of debit_amount > 0 OR credit_amount > 0 (not both, not neither)',
    }
  );
export type CreateJournalLineRequest = z.infer<typeof CreateJournalLineRequestSchema>;

/**
 * POST /api/v1/erp-finance/journal-entries — request body.
 *
 * Application-level invariants validated here (DB enforces per-line constraints):
 *   - At least 2 lines (minimum meaningful double-entry: 1 debit + 1 credit)
 *   - All lines in same currency as header
 *   - SUM(debit) == SUM(credit) at 4 decimal place precision
 */
export const CreateJournalEntryRequestSchema = z
  .object({
    period_id: UuidSchema,
    posting_date: z.string().date(),
    description: z.string().min(1).max(2000),
    currency_code: CurrencyCode,
    source_reference: z.string().max(128).optional().nullable(),
    idempotency_key: z.string().max(128).optional().nullable(),
    batch_id: UuidSchema.optional().nullable(),
    source_row: z.number().int().nonnegative().optional().nullable(),
    lines: z
      .array(CreateJournalLineRequestSchema)
      .min(2, 'A journal entry must have at least 2 lines'),
  })
  .refine(
    (entry) => {
      // BR-ERP4-01: SUM(debits) must equal SUM(credits) at 4dp
      const totalDebit = entry.lines.reduce(
        (sum, l) => sum + Math.round(parseFloat(l.debit_amount) * 10000),
        0
      );
      const totalCredit = entry.lines.reduce(
        (sum, l) => sum + Math.round(parseFloat(l.credit_amount) * 10000),
        0
      );
      return totalDebit === totalCredit;
    },
    {
      message:
        'Journal entry is not balanced: SUM(debit_amount) must equal SUM(credit_amount) at 4 decimal precision',
      path: ['lines'],
    }
  );
export type CreateJournalEntryRequest = z.infer<typeof CreateJournalEntryRequestSchema>;

/**
 * BR-ERP4-01: Validates that total debits equal total credits.
 * Supports both frontend models ({ debit, credit }) and API/DB models ({ debit_amount, credit_amount }).
 */
export function isJournalEntryBalanced(
  lines: Array<{
    debit?: number | string;
    credit?: number | string;
    debit_amount?: number | string;
    credit_amount?: number | string;
  }>
): boolean {
  if (!lines || lines.length < 2) return false;
  const totalDebit = lines.reduce((sum, l) => {
    const val = l.debit !== undefined ? Number(l.debit) : Number(l.debit_amount ?? 0);
    return sum + Math.round(val * 10000);
  }, 0);
  const totalCredit = lines.reduce((sum, l) => {
    const val = l.credit !== undefined ? Number(l.credit) : Number(l.credit_amount ?? 0);
    return sum + Math.round(val * 10000);
  }, 0);
  return totalDebit === totalCredit;
}

/** PATCH /api/v1/erp-finance/journal-entries/:id — request body (draft edits). */
export const UpdateJournalEntryRequestSchema = z
  .object({
    posting_date: z.string().date().optional(),
    description: z.string().min(1).max(2000).optional(),
    period_id: UuidSchema.optional(),
    lines: z
      .array(CreateJournalLineRequestSchema)
      .min(2, 'A journal entry must have at least 2 lines')
      .optional(),
  })
  .refine(
    (entry) => {
      if (!entry.lines) return true;
      const totalDebit = entry.lines.reduce(
        (sum, l) => sum + Math.round(parseFloat(l.debit_amount) * 10000),
        0
      );
      const totalCredit = entry.lines.reduce(
        (sum, l) => sum + Math.round(parseFloat(l.credit_amount) * 10000),
        0
      );
      return totalDebit === totalCredit;
    },
    {
      message:
        'Journal entry is not balanced: SUM(debit_amount) must equal SUM(credit_amount) at 4 decimal precision',
      path: ['lines'],
    }
  );
export type UpdateJournalEntryRequest = z.infer<typeof UpdateJournalEntryRequestSchema>;

/** GET /api/v1/erp-finance/journal-entries — list query params with bounded pagination. */
export const JournalEntryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page must be greater than or equal to 1').default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize must be greater than or equal to 1')
    .max(100, 'pageSize cannot exceed 100')
    .default(20),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(100).optional(),
  period: PeriodLabel.optional(),
  period_id: UuidSchema.optional(),
  status: JournalEntryStatusEnum.optional(),
  from_date: z.string().date().optional(),
  to_date: z.string().date().optional(),
  currency_code: CurrencyCode.optional(),
});
export type JournalEntryListQuery = z.infer<typeof JournalEntryListQuerySchema>;

/** GET /api/v1/erp-finance/journal-entries — response wrapper. */
export const JournalEntryListResponseSchema = z.object({
  data: z.array(JournalEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().default(20),
  limit: z.number().int().positive().optional(),
  totalPages: z.number().int().nonnegative().default(1),
});
export type JournalEntryListResponse = z.infer<typeof JournalEntryListResponseSchema>;

/** POST /api/v1/erp-finance/journal-entries/:id/reverse — optional note. */
export const ReverseJournalEntryRequestSchema = z.object({
  reversal_date: z.string().date().optional(),
  reversal_description: z.string().min(1).max(2000).optional(),
});
export type ReverseJournalEntryRequest = z.infer<typeof ReverseJournalEntryRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Trial Balance schemas
// GET /api/v1/erp-finance/trial-balance?period=YYYY-MM
// ─────────────────────────────────────────────────────────────────────────────

/** One row in the trial balance (one account, one currency). */
export const TrialBalanceRowSchema = z.object({
  account_id: UuidSchema,
  account_code: z.string(),
  account_name: z.string(),
  account_type: AccountTypeEnum,
  currency_code: CurrencyCode,
  total_debit: z.string(),
  total_credit: z.string(),
  /** Net balance = total_debit - total_credit (signed, may be negative). */
  net_balance: z.string(),
  opening_balance: z.string(),
  closing_balance: z.string(),
});
export type TrialBalanceRow = z.infer<typeof TrialBalanceRowSchema>;

/** GET /api/v1/erp-finance/trial-balance — response. */
export const TrialBalanceResponseSchema = z.object({
  period: PeriodLabel,
  generated_at: z.string().datetime(),
  rows: z.array(TrialBalanceRowSchema),
  totals: z.object({
    total_debit: z.string(),
    total_credit: z.string(),
    /** Should be "0.0000" for a balanced ledger. */
    difference: z.string(),
    is_balanced: z.boolean(),
  }),
});
export type TrialBalanceResponse = z.infer<typeof TrialBalanceResponseSchema>;

/** GET /api/v1/erp-finance/trial-balance — query params. */
export const TrialBalanceQuerySchema = z.object({
  period: PeriodLabel,
  currency_code: CurrencyCode.optional(),
});
export type TrialBalanceQuery = z.infer<typeof TrialBalanceQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Opening Balance schemas
// POST /api/v1/erp-finance/opening-balances
// ─────────────────────────────────────────────────────────────────────────────

/** One opening balance item in a bulk-load request. */
export const OpeningBalanceItemSchema = z.object({
  account_id: UuidSchema,
  currency_code: CurrencyCode,
  balance_amount: z
    .string()
    .regex(/^-?\d+(\.\d{1,4})?$/, 'Balance amount must be a signed decimal with up to 4 dp'),
  as_of_date: z.string().date(),
  source_reference: z.string().max(128).optional().nullable(),
  idempotency_key: z.string().max(128).optional().nullable(),
  batch_id: UuidSchema.optional().nullable(),
  source_row: z.number().int().nonnegative().optional().nullable(),
});
export type OpeningBalanceItem = z.infer<typeof OpeningBalanceItemSchema>;

/** Import receipt record schema (Decision C4 & KIT-08). */
export const ImportReceiptSchema = z.object({
  id: UuidSchema,
  batch_id: UuidSchema,
  source_row: z.number().int().nonnegative(),
  entity: z.string().min(1).max(64),
  schema_version: z.number().int().positive().default(1),
  idempotency_key: z.string().min(1).max(128),
  target_id: UuidSchema,
  kind: z.enum(['created', 'linked']).default('created'),
  created_at: z.string().datetime(),
});
export type ImportReceipt = z.infer<typeof ImportReceiptSchema>;

/** POST /api/v1/erp-finance/opening-balances — request body (bulk). */
export const CreateOpeningBalancesRequestSchema = z.object({
  batch_id: UuidSchema.optional().nullable(),
  idempotency_key: z.string().max(128).optional().nullable(),
  balances: z
    .array(OpeningBalanceItemSchema)
    .min(1, 'At least one opening balance item is required'),
});
export type CreateOpeningBalancesRequest = z.infer<typeof CreateOpeningBalancesRequestSchema>;

/** Response shape for an opening balance record. */
export const OpeningBalanceSchema = z.object({
  id: UuidSchema,
  account_id: UuidSchema,
  currency_code: CurrencyCode,
  balance_amount: z.string(),
  as_of_date: z.string().date(),
  source_reference: z.string().max(128).nullable(),
  loaded_by_user_id: UuidSchema,
  created_at: z.string().datetime(),
});
export type OpeningBalance = z.infer<typeof OpeningBalanceSchema>;

/** POST /api/v1/erp-finance/opening-balances — response. */
export const CreateOpeningBalancesResponseSchema = z.object({
  created: z.array(OpeningBalanceSchema),
  skipped: z.array(
    z.object({
      account_id: UuidSchema,
      currency_code: CurrencyCode,
      reason: z.string(),
    })
  ),
  receipts: z.array(ImportReceiptSchema).optional(),
});
export type CreateOpeningBalancesResponse = z.infer<typeof CreateOpeningBalancesResponseSchema>;

/** GET /api/v1/erp-finance/opening-balances — query params with bounded pagination. */
export const OpeningBalanceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page must be greater than or equal to 1').default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize must be greater than or equal to 1')
    .max(100, 'pageSize cannot exceed 100')
    .default(20),
  account_id: UuidSchema.optional(),
  currency_code: CurrencyCode.optional(),
});
export type OpeningBalanceListQuery = z.infer<typeof OpeningBalanceListQuerySchema>;

/** GET /api/v1/erp-finance/opening-balances — response wrapper with bounded paging. */
export const OpeningBalanceListResponseSchema = z.object({
  data: z.array(OpeningBalanceSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type OpeningBalanceListResponse = z.infer<typeof OpeningBalanceListResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Accounting Period schemas
// GET /api/v1/erp-finance/periods
// GET /api/v1/erp-finance/periods/:id
// ─────────────────────────────────────────────────────────────────────────────

/** Response shape for an accounting period. */
export const AccountingPeriodSchema = z.object({
  id: UuidSchema,
  period_label: PeriodLabel,
  start_date: z.string().date(),
  end_date: z.string().date(),
  status: PeriodStatusEnum,
  fiscal_year: z.string().min(1).max(9),
  closed_at: z.string().datetime().nullable(),
  closed_by_user_id: UuidSchema.nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type AccountingPeriod = z.infer<typeof AccountingPeriodSchema>;

/** GET /api/v1/erp-finance/periods — list query params with bounded pagination. */
export const PeriodListQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'page must be greater than or equal to 1').default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize must be greater than or equal to 1')
    .max(100, 'pageSize cannot exceed 100')
    .default(20),
  status: PeriodStatusEnum.optional(),
  fiscal_year: z.string().optional(),
});
export type PeriodListQuery = z.infer<typeof PeriodListQuerySchema>;

/** GET /api/v1/erp-finance/periods — response wrapper. */
export const PeriodListResponseSchema = z.object({
  data: z.array(AccountingPeriodSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type PeriodListResponse = z.infer<typeof PeriodListResponseSchema>;

/** PATCH /api/v1/erp-finance/periods/:id — request body. */
export const UpdatePeriodRequestSchema = z.object({
  status: PeriodStatusEnum.optional(),
});
export type UpdatePeriodRequest = z.infer<typeof UpdatePeriodRequestSchema>;

/** Optional relationship warning shape. */
export const RelationshipWarningSchema = z.object({
  relationship: z.string(),
  field: z.string(),
  code: z.literal('OPTIONAL_REFERENCE_ABSENT'),
  message: z.string(),
});
export type RelationshipWarning = z.infer<typeof RelationshipWarningSchema>;

export const RELATIONSHIP_ERROR_CODES = {
  PARENT_NOT_FOUND: 'PARENT_NOT_FOUND',
  CYCLE_DETECTED: 'CYCLE_DETECTED',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  CANNOT_POST_TO_HEADER_ACCOUNT: 'CANNOT_POST_TO_HEADER_ACCOUNT',
  PERIOD_NOT_FOUND: 'PERIOD_NOT_FOUND',
  PERIOD_LOCKED: 'PERIOD_LOCKED',
  PERIOD_SOFT_CLOSED: 'PERIOD_SOFT_CLOSED',
  INVALID_PERIOD_TRANSITION: 'INVALID_PERIOD_TRANSITION',
  MINIMUM_LINES_REQUIRED: 'MINIMUM_LINES_REQUIRED',
  LINE_DEBIT_AND_CREDIT: 'LINE_DEBIT_AND_CREDIT',
  LINE_ZERO_AMOUNTS: 'LINE_ZERO_AMOUNTS',
  UNBALANCED_ENTRY: 'UNBALANCED_ENTRY',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  ENTRY_IMMUTABLE: 'ENTRY_IMMUTABLE',
  NOT_REVERSIBLE: 'NOT_REVERSIBLE',
  DUPLICATE_OPENING_BALANCE: 'DUPLICATE_OPENING_BALANCE',
  MISSING_REQUIRED_REFERENCE: 'MISSING_REQUIRED_REFERENCE',
  INVALID_REFERENCE: 'INVALID_REFERENCE',
  DEPARTMENT_NOT_FOUND: 'DEPARTMENT_NOT_FOUND',
  SOURCE_ENTITY_NOT_FOUND: 'SOURCE_ENTITY_NOT_FOUND',
  INVALID_ENUM_VALUE: 'INVALID_ENUM_VALUE',
  READ_MODEL_INCONSISTENT: 'READ_MODEL_INCONSISTENT',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Shared error response
// ─────────────────────────────────────────────────────────────────────────────

export const ApiErrorSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  code: z.string().optional(),
  message: z.string(),
  details: z.array(z.unknown()).optional(),
  correlation_id: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Frontend Compatibility & View Model Type Aliases
// ─────────────────────────────────────────────────────────────────────────────

export interface AccountsFilterQuery {
  page?: number;
  limit?: number;
  pageSize?: number;
  search?: string;
  type?: AccountType;
  isActive?: boolean;
  is_active?: boolean;
  currencyCode?: string;
  currency_code?: string;
}

export interface PaginatedAccountsResponse {
  items: Account[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type CreateAccountInput = CreateAccountRequest;
export type CreateJournalEntryInput = CreateJournalEntryRequest;
export type CreateOpeningBalancesInput = CreateOpeningBalancesRequest;
export type OpeningBalancesResponse = CreateOpeningBalancesResponse;

export interface JournalEntriesFilterQuery {
  page?: number;
  limit?: number;
  pageSize?: number;
  period?: string;
  status?: JournalEntryStatus;
  search?: string;
  currencyCode?: string;
  currency_code?: string;
}

export interface PaginatedJournalEntriesResponse {
  items: JournalEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
