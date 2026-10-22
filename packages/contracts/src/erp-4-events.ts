/**
 * ERP-4 Finance & Accounting — Domain Event Contracts
 *
 * Strongly-typed domain event schemas conforming to ClearShift Transactional
 * Event Envelope Schema (PLT-04 / PLT-09).
 *
 * Implements:
 *   - Account lifecycle events (created, updated)
 *   - Journal entry lifecycle events (created, posted, reversed, voided)
 *   - Accounting period status transitions (open -> soft_closed -> locked)
 *   - Opening balance loads
 *   - Cross-module inbound event payload definitions (ERP-2, ERP-3, ERP-5)
 *
 * @module contracts/erp-4-events
 */

import { z } from 'zod';
import {
  CurrencyCode,
  MoneyAmount,
  PeriodLabel,
  AccountTypeEnum,
  JournalEntryStatusEnum,
  PeriodStatusEnum,
  UuidSchema,
} from './erp-4.js';
import { createEventEnvelopeSchema, createEventEnvelope, type EventEnvelope } from './events.js';

// ─────────────────────────────────────────────────────────────────────────────
// Event Type Constants
// ─────────────────────────────────────────────────────────────────────────────

export const ERP4_EVENT_TYPES = {
  ACCOUNT_CREATED: 'erp.account.created',
  ACCOUNT_UPDATED: 'erp.account.updated',
  JOURNAL_ENTRY_CREATED: 'erp.journal_entry.created',
  JOURNAL_ENTRY_POSTED: 'erp.journal_entry.posted',
  JOURNAL_ENTRY_REVERSED: 'erp.journal_entry.reversed',
  JOURNAL_ENTRY_VOIDED: 'erp.journal_entry.voided',
  PERIOD_STATUS_CHANGED: 'erp.period.status_changed',
  OPENING_BALANCE_CREATED: 'erp.opening_balance.created',
  // Inbound cross-module event types consumed or projected by ERP-4
  INBOUND_VENDOR_BILL_POSTED: 'erp.vendor_bill.posted',
  INBOUND_INVOICE_POSTED: 'erp.invoice.posted',
  INBOUND_PAYROLL_TOTAL_POSTED: 'erp.payroll_total.posted',
} as const;

export type Erp4EventType = (typeof ERP4_EVENT_TYPES)[keyof typeof ERP4_EVENT_TYPES];

// ─────────────────────────────────────────────────────────────────────────────
// Event Payload Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const AccountCreatedPayloadSchema = z.object({
  id: UuidSchema,
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(255),
  type: AccountTypeEnum,
  currency_code: CurrencyCode,
  is_posting_account: z.boolean(),
  is_active: z.boolean(),
  parent_id: UuidSchema.nullable(),
});
export type AccountCreatedPayload = z.infer<typeof AccountCreatedPayloadSchema>;

export const AccountUpdatedPayloadSchema = z.object({
  id: UuidSchema,
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(255),
  type: AccountTypeEnum,
  currency_code: CurrencyCode,
  is_active: z.boolean(),
  is_posting_account: z.boolean(),
  parent_id: UuidSchema.nullable(),
});
export type AccountUpdatedPayload = z.infer<typeof AccountUpdatedPayloadSchema>;

export const JournalEntryCreatedPayloadSchema = z.object({
  id: UuidSchema,
  entry_number: z.string().min(1).max(64),
  period_id: UuidSchema,
  posting_date: z.string().date(),
  status: z.literal('draft'),
  description: z.string().min(1),
  currency_code: CurrencyCode,
  line_count: z.number().int().min(2),
  total_debit: MoneyAmount,
  total_credit: MoneyAmount,
});
export type JournalEntryCreatedPayload = z.infer<typeof JournalEntryCreatedPayloadSchema>;

export const JournalEntryPostedPayloadSchema = z.object({
  id: UuidSchema,
  entry_number: z.string().min(1).max(64),
  period_id: UuidSchema,
  posting_date: z.string().date(),
  status: z.literal('posted'),
  description: z.string().min(1),
  currency_code: CurrencyCode,
  posted_at: z.string().datetime(),
  posted_by_user_id: UuidSchema,
  total_amount: MoneyAmount,
  line_count: z.number().int().min(2),
});
export type JournalEntryPostedPayload = z.infer<typeof JournalEntryPostedPayloadSchema>;

export const JournalEntryReversedPayloadSchema = z.object({
  original_entry_id: UuidSchema,
  original_entry_number: z.string().min(1).max(64),
  reversal_entry_id: UuidSchema,
  reversal_entry_number: z.string().min(1).max(64),
  reversal_date: z.string().date(),
  currency_code: CurrencyCode,
  total_amount: MoneyAmount,
  reason: z.string().optional(),
});
export type JournalEntryReversedPayload = z.infer<typeof JournalEntryReversedPayloadSchema>;

export const JournalEntryVoidedPayloadSchema = z.object({
  id: UuidSchema,
  entry_number: z.string().min(1).max(64),
  voided_at: z.string().datetime(),
  voided_by_user_id: UuidSchema.optional(),
});
export type JournalEntryVoidedPayload = z.infer<typeof JournalEntryVoidedPayloadSchema>;

export const PeriodStatusChangedPayloadSchema = z.object({
  id: UuidSchema,
  period_label: PeriodLabel,
  previous_status: PeriodStatusEnum,
  new_status: PeriodStatusEnum,
  fiscal_year: z.string().min(1).max(9),
  changed_at: z.string().datetime(),
  changed_by_user_id: UuidSchema,
});
export type PeriodStatusChangedPayload = z.infer<typeof PeriodStatusChangedPayloadSchema>;

export const OpeningBalanceCreatedPayloadSchema = z.object({
  id: UuidSchema,
  account_id: UuidSchema,
  currency_code: CurrencyCode,
  balance_amount: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
  as_of_date: z.string().date(),
  source_reference: z.string().nullable().optional(),
});
export type OpeningBalanceCreatedPayload = z.infer<typeof OpeningBalanceCreatedPayloadSchema>;

// Cross-Module Inbound Payloads
export const InboundVendorBillPostedPayloadSchema = z.object({
  bill_id: UuidSchema,
  vendor_id: UuidSchema,
  bill_number: z.string().min(1),
  amount: MoneyAmount,
  currency_code: CurrencyCode,
  posting_date: z.string().date(),
  expense_account_id: UuidSchema,
  liability_account_id: UuidSchema,
});
export type InboundVendorBillPostedPayload = z.infer<typeof InboundVendorBillPostedPayloadSchema>;

export const InboundInvoicePostedPayloadSchema = z.object({
  invoice_id: UuidSchema,
  customer_id: UuidSchema,
  invoice_number: z.string().min(1),
  amount: MoneyAmount,
  currency_code: CurrencyCode,
  posting_date: z.string().date(),
  receivable_account_id: UuidSchema,
  revenue_account_id: UuidSchema,
});
export type InboundInvoicePostedPayload = z.infer<typeof InboundInvoicePostedPayloadSchema>;

export const InboundPayrollTotalPostedPayloadSchema = z.object({
  payroll_total_id: UuidSchema,
  department_id: UuidSchema,
  month: PeriodLabel,
  total_amount: MoneyAmount,
  currency_code: CurrencyCode,
  posting_date: z.string().date(),
});
export type InboundPayrollTotalPostedPayload = z.infer<typeof InboundPayrollTotalPostedPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Event Envelope Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const AccountCreatedEventSchema = createEventEnvelopeSchema(AccountCreatedPayloadSchema);
export const AccountUpdatedEventSchema = createEventEnvelopeSchema(AccountUpdatedPayloadSchema);
export const JournalEntryCreatedEventSchema = createEventEnvelopeSchema(JournalEntryCreatedPayloadSchema);
export const JournalEntryPostedEventSchema = createEventEnvelopeSchema(JournalEntryPostedPayloadSchema);
export const JournalEntryReversedEventSchema = createEventEnvelopeSchema(JournalEntryReversedPayloadSchema);
export const JournalEntryVoidedEventSchema = createEventEnvelopeSchema(JournalEntryVoidedPayloadSchema);
export const PeriodStatusChangedEventSchema = createEventEnvelopeSchema(PeriodStatusChangedPayloadSchema);
export const OpeningBalanceCreatedEventSchema = createEventEnvelopeSchema(OpeningBalanceCreatedPayloadSchema);

// Inbound envelopes
export const InboundVendorBillPostedEventSchema = createEventEnvelopeSchema(InboundVendorBillPostedPayloadSchema);
export const InboundInvoicePostedEventSchema = createEventEnvelopeSchema(InboundInvoicePostedPayloadSchema);
export const InboundPayrollTotalPostedEventSchema = createEventEnvelopeSchema(InboundPayrollTotalPostedPayloadSchema);

// ─────────────────────────────────────────────────────────────────────────────
// Event Helper Factory Functions
// ─────────────────────────────────────────────────────────────────────────────

export function createErp4Event<T>(params: {
  event_id?: string | undefined;
  event_type: Erp4EventType;
  schema_version?: string | undefined;
  occurred_at?: string | undefined;
  correlation_id: string;
  entity_type: 'account' | 'journal_entry' | 'accounting_period' | 'opening_balance' | 'bill' | 'invoice' | 'payroll_total';
  entity_id: string;
  batch_id?: string | undefined;
  payload: T;
  metadata?: Record<string, unknown> | undefined;
}): EventEnvelope {
  const envelopeParams: Parameters<typeof createEventEnvelope>[0] = {
    event_id: params.event_id ?? crypto.randomUUID(),
    event_type: params.event_type,
    correlation_id: params.correlation_id,
    producer: 'erp-4',
    entity_type: params.entity_type,
    entity_id: params.entity_id,
    payload: params.payload,
  };
  if (params.schema_version !== undefined) {
    envelopeParams.schema_version = params.schema_version;
  }
  if (params.occurred_at !== undefined) {
    envelopeParams.occurred_at = params.occurred_at;
  }
  if (params.batch_id !== undefined && params.batch_id !== null) {
    envelopeParams.batch_id = params.batch_id;
  }
  if (params.metadata !== undefined) {
    envelopeParams.metadata = params.metadata;
  }
  return createEventEnvelope(envelopeParams);
}
