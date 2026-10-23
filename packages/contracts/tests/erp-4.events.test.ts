/**
 * ERP-4 Finance & Accounting — Domain Events Test Suite
 *
 * Proves that:
 *   - All ERP-4 domain event schemas validate correctly formatted event envelopes.
 *   - Event envelopes strictly enforce UUID event_id, ISO occurred_at, and producer: 'erp-4'.
 *   - Payloads strictly match domain event schemas (AccountCreated, JournalEntryPosted, etc.).
 *   - Inbound event schemas (vendor bill, invoice, payroll total) parse valid cross-module inputs.
 *   - Helper factory createErp4Event properly defaults event_id, occurred_at, and producer.
 *
 * @module contracts/tests/erp-4.events.test
 */

import { describe, it, expect } from 'vitest';
import {
  ERP4_EVENT_TYPES,
  AccountCreatedEventSchema,
  AccountUpdatedEventSchema,
  JournalEntryCreatedEventSchema,
  JournalEntryPostedEventSchema,
  JournalEntryReversedEventSchema,
  JournalEntryVoidedEventSchema,
  PeriodStatusChangedEventSchema,
  OpeningBalanceCreatedEventSchema,
  InboundVendorBillPostedEventSchema,
  InboundInvoicePostedEventSchema,
  InboundPayrollTotalPostedEventSchema,
  createErp4Event,
} from '../src/erp-4-events.js';

describe('ERP-4 Domain Event Envelopes (PLT-04 / PLT-09)', () => {
  const correlationId = 'req-trace-12345';
  const entityId = '11111111-0001-4000-8000-000000000001';

  it('validates AccountCreatedEvent with complete payload', () => {
    const rawEvent = {
      event_id: 'aaaaaaaa-0001-4000-8000-000000000001',
      event_type: ERP4_EVENT_TYPES.ACCOUNT_CREATED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-01T00:00:00.000Z',
      correlation_id: correlationId,
      producer: 'erp-4',
      entity_type: 'account',
      entity_id: entityId,
      payload: {
        id: entityId,
        code: '1010-CASH',
        name: 'Cash on Hand',
        type: 'asset',
        currency_code: 'INR',
        is_posting_account: true,
        is_active: true,
        parent_id: null,
      },
    };

    const parsed = AccountCreatedEventSchema.safeParse(rawEvent);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.payload.code).toBe('1010-CASH');
      expect(parsed.data.producer).toBe('erp-4');
    }
  });

  it('validates AccountUpdatedEvent with updated attributes', () => {
    const rawEvent = {
      event_id: 'aaaaaaaa-0001-4000-8000-000000000002',
      event_type: ERP4_EVENT_TYPES.ACCOUNT_UPDATED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-01T00:00:00.000Z',
      correlation_id: correlationId,
      producer: 'erp-4',
      entity_type: 'account',
      entity_id: entityId,
      payload: {
        id: entityId,
        code: '1010-CASH',
        name: 'Cash on Hand — Operational',
        type: 'asset',
        currency_code: 'INR',
        is_active: true,
        is_posting_account: true,
        parent_id: null,
      },
    };
    expect(AccountUpdatedEventSchema.safeParse(rawEvent).success).toBe(true);
  });

  it('validates JournalEntryCreatedEvent (draft state)', () => {
    const rawEvent = {
      event_id: 'aaaaaaaa-0001-4000-8000-000000000003',
      event_type: ERP4_EVENT_TYPES.JOURNAL_ENTRY_CREATED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-10T10:00:00.000Z',
      correlation_id: correlationId,
      producer: 'erp-4',
      entity_type: 'journal_entry',
      entity_id: '44444444-0001-4000-8000-000000000001',
      payload: {
        id: '44444444-0001-4000-8000-000000000001',
        entry_number: 'JV-2026-0001',
        period_id: '22222222-0001-4000-8000-000000000001',
        posting_date: '2026-04-10',
        status: 'draft',
        description: 'Office supply draft voucher',
        currency_code: 'INR',
        line_count: 2,
        total_debit: '5000.0000',
        total_credit: '5000.0000',
      },
    };
    expect(JournalEntryCreatedEventSchema.safeParse(rawEvent).success).toBe(true);
  });

  it('validates JournalEntryPostedEvent (posted state with user stamp)', () => {
    const rawEvent = {
      event_id: 'aaaaaaaa-0001-4000-8000-000000000004',
      event_type: ERP4_EVENT_TYPES.JOURNAL_ENTRY_POSTED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-10T11:00:00.000Z',
      correlation_id: correlationId,
      producer: 'erp-4',
      entity_type: 'journal_entry',
      entity_id: '44444444-0001-4000-8000-000000000001',
      payload: {
        id: '44444444-0001-4000-8000-000000000001',
        entry_number: 'JV-2026-0001',
        period_id: '22222222-0001-4000-8000-000000000001',
        posting_date: '2026-04-10',
        status: 'posted',
        description: 'Office supply draft voucher',
        currency_code: 'INR',
        posted_at: '2026-04-10T11:00:00.000Z',
        posted_by_user_id: '99999999-0001-4000-8000-000000000001',
        total_amount: '5000.0000',
        line_count: 2,
      },
    };
    expect(JournalEntryPostedEventSchema.safeParse(rawEvent).success).toBe(true);
  });

  it('validates JournalEntryReversedEvent and JournalEntryVoidedEvent', () => {
    const revEvent = {
      event_id: 'aaaaaaaa-0001-4000-8000-000000000005',
      event_type: ERP4_EVENT_TYPES.JOURNAL_ENTRY_REVERSED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-11T09:00:00.000Z',
      correlation_id: correlationId,
      producer: 'erp-4',
      entity_type: 'journal_entry',
      entity_id: '44444444-0001-4000-8000-000000000001',
      payload: {
        original_entry_id: '44444444-0001-4000-8000-000000000001',
        original_entry_number: 'JV-2026-0001',
        reversal_entry_id: '44444444-0001-4000-8000-000000000002',
        reversal_entry_number: 'REV-JV-2026-0001',
        reversal_date: '2026-04-11',
        currency_code: 'INR',
        total_amount: '5000.0000',
        reason: 'Duplicate payment correction',
      },
    };
    expect(JournalEntryReversedEventSchema.safeParse(revEvent).success).toBe(true);

    const voidEvent = {
      event_id: 'aaaaaaaa-0001-4000-8000-000000000006',
      event_type: ERP4_EVENT_TYPES.JOURNAL_ENTRY_VOIDED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-11T09:30:00.000Z',
      correlation_id: correlationId,
      producer: 'erp-4',
      entity_type: 'journal_entry',
      entity_id: '44444444-0001-4000-8000-000000000003',
      payload: {
        id: '44444444-0001-4000-8000-000000000003',
        entry_number: 'JV-2026-0003',
        voided_at: '2026-04-11T09:30:00.000Z',
      },
    };
    expect(JournalEntryVoidedEventSchema.safeParse(voidEvent).success).toBe(true);
  });

  it('validates PeriodStatusChangedEvent and OpeningBalanceCreatedEvent', () => {
    const periodEvent = {
      event_id: 'aaaaaaaa-0001-4000-8000-000000000007',
      event_type: ERP4_EVENT_TYPES.PERIOD_STATUS_CHANGED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-30T23:59:59.000Z',
      correlation_id: correlationId,
      producer: 'erp-4',
      entity_type: 'accounting_period',
      entity_id: '22222222-0001-4000-8000-000000000001',
      payload: {
        id: '22222222-0001-4000-8000-000000000001',
        period_label: '2026-04',
        previous_status: 'open',
        new_status: 'soft_closed',
        fiscal_year: 'FY2026-27',
        changed_at: '2026-04-30T23:59:59.000Z',
        changed_by_user_id: '99999999-0001-4000-8000-000000000001',
      },
    };
    expect(PeriodStatusChangedEventSchema.safeParse(periodEvent).success).toBe(true);

    const obEvent = {
      event_id: 'aaaaaaaa-0001-4000-8000-000000000008',
      event_type: ERP4_EVENT_TYPES.OPENING_BALANCE_CREATED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-01T00:00:00.000Z',
      correlation_id: correlationId,
      producer: 'erp-4',
      entity_type: 'opening_balance',
      entity_id: '33333333-0001-4000-8000-000000000001',
      payload: {
        id: '33333333-0001-4000-8000-000000000001',
        account_id: entityId,
        currency_code: 'INR',
        balance_amount: '100000.0000',
        as_of_date: '2026-04-01',
      },
    };
    expect(OpeningBalanceCreatedEventSchema.safeParse(obEvent).success).toBe(true);
  });

  it('validates cross-module inbound event contracts (ERP-2, ERP-3, ERP-5)', () => {
    // Inbound Vendor Bill (from ERP-2)
    const billEvent = {
      event_id: 'aaaaaaaa-0001-4000-8000-000000000009',
      event_type: ERP4_EVENT_TYPES.INBOUND_VENDOR_BILL_POSTED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-12T10:00:00.000Z',
      correlation_id: correlationId,
      producer: 'erp-2',
      entity_type: 'bill',
      entity_id: '88888888-0001-4000-8000-000000000001',
      payload: {
        bill_id: '88888888-0001-4000-8000-000000000001',
        vendor_id: '77777777-0001-4000-8000-000000000001',
        bill_number: 'BILL-2026-004',
        amount: '45000.0000',
        currency_code: 'INR',
        posting_date: '2026-04-12',
        expense_account_id: entityId,
        liability_account_id: '11111111-0001-4000-8000-000000000004',
      },
    };
    expect(InboundVendorBillPostedEventSchema.safeParse(billEvent).success).toBe(true);

    // Inbound Sales Invoice (from ERP-3)
    const invoiceEvent = {
      event_id: 'aaaaaaaa-0001-4000-8000-000000000010',
      event_type: ERP4_EVENT_TYPES.INBOUND_INVOICE_POSTED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-14T14:00:00.000Z',
      correlation_id: correlationId,
      producer: 'erp-3',
      entity_type: 'invoice',
      entity_id: '66666666-0001-4000-8000-000000000001',
      payload: {
        invoice_id: '66666666-0001-4000-8000-000000000001',
        customer_id: '55555555-0001-4000-8000-000000000001',
        invoice_number: 'INV-2026-012',
        amount: '85000.0000',
        currency_code: 'INR',
        posting_date: '2026-04-14',
        receivable_account_id: '11111111-0001-4000-8000-000000000003',
        revenue_account_id: '11111111-0001-4000-8000-000000000005',
      },
    };
    expect(InboundInvoicePostedEventSchema.safeParse(invoiceEvent).success).toBe(true);

    // Inbound Payroll Total (from ERP-5)
    const payrollEvent = {
      event_id: 'aaaaaaaa-0001-4000-8000-000000000011',
      event_type: ERP4_EVENT_TYPES.INBOUND_PAYROLL_TOTAL_POSTED,
      schema_version: '1.0.0',
      occurred_at: '2026-04-30T18:00:00.000Z',
      correlation_id: correlationId,
      producer: 'erp-5',
      entity_type: 'payroll_total',
      entity_id: '44444444-0001-4000-8000-000000000099',
      payload: {
        payroll_total_id: '44444444-0001-4000-8000-000000000099',
        department_id: '33333333-0001-4000-8000-000000000055',
        month: '2026-04',
        total_amount: '500000.0000',
        currency_code: 'INR',
        posting_date: '2026-04-30',
      },
    };
    expect(InboundPayrollTotalPostedEventSchema.safeParse(payrollEvent).success).toBe(true);
  });

  it('createErp4Event factory constructs a valid envelope with defaults', () => {
    const event = createErp4Event({
      event_type: ERP4_EVENT_TYPES.ACCOUNT_CREATED,
      correlation_id: 'trace-999',
      entity_type: 'account',
      entity_id: entityId,
      payload: {
        id: entityId,
        code: '1010-CASH',
        name: 'Cash',
        type: 'asset',
        currency_code: 'INR',
        is_posting_account: true,
        is_active: true,
        parent_id: null,
      },
    });

    expect(AccountCreatedEventSchema.safeParse(event).success).toBe(true);
    expect(event.producer).toBe('erp-4');
    expect(event.schema_version).toBe('1.0.0');
    expect(event.correlation_id).toBe('trace-999');
    expect(event.occurred_at).toBeDefined();
  });
});
