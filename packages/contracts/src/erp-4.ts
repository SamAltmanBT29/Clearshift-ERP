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
});
export type CreateAccountRequest = z.infer<typeof CreateAccountRequestSchema>;

/** GET /api/v1/erp-finance/accounts — response wrapper. */
export const AccountListResponseSchema = z.object({
  data: z.array(AccountSchema),
  total: z.number().int().nonnegative(),
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

/** GET /api/v1/erp-finance/journal-entries — list query params. */
export const JournalEntryListQuerySchema = z.object({
  period: PeriodLabel.optional(),
  status: JournalEntryStatusEnum.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type JournalEntryListQuery = z.infer<typeof JournalEntryListQuerySchema>;

/** GET /api/v1/erp-finance/journal-entries — response wrapper. */
export const JournalEntryListResponseSchema = z.object({
  data: z.array(JournalEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
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
});
export type OpeningBalanceItem = z.infer<typeof OpeningBalanceItemSchema>;

/** POST /api/v1/erp-finance/opening-balances — request body (bulk). */
export const CreateOpeningBalancesRequestSchema = z.object({
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
});
export type CreateOpeningBalancesResponse = z.infer<typeof CreateOpeningBalancesResponseSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Shared error response
// ─────────────────────────────────────────────────────────────────────────────

export const ApiErrorSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  details: z.array(z.unknown()).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
