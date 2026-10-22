/**
 * ERP-4 Finance & Accounting — Deterministic Mock Server & Contract Package
 *
 * Provides a production-grade, zero-external-dependency mock server and
 * deterministic fixture dataset for dependent teams (ERP-2, ERP-3, ERP-5, CRM-5).
 *
 * Conforms strictly to:
 *   - ClearShift V1 Master Architecture Spec §7.9
 *   - ADR-002: Shared Zod/OpenAPI Contract & Error Envelope
 *   - BR-ERP4-01: Double-Entry Exact Balancing (total debits == total credits)
 *   - BR-ERP4-02: Fiscal Period Lifecycle & Posting Guard
 *   - PLT-04 / PLT-09: Bounded Pagination & Transactional Event Envelopes
 *
 * @module contracts/erp-4-mock
 */

import fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import {
  AccountSchema,
  CreateAccountRequestSchema,
  UpdateAccountRequestSchema,
  AccountListQuerySchema,
  AccountListResponseSchema,
  JournalEntrySchema,
  CreateJournalEntryRequestSchema,
  UpdateJournalEntryRequestSchema,
  JournalEntryListQuerySchema,
  JournalEntryListResponseSchema,
  ReverseJournalEntryRequestSchema,
  TrialBalanceQuerySchema,
  TrialBalanceResponseSchema,
  CreateOpeningBalancesRequestSchema,
  CreateOpeningBalancesResponseSchema,
  OpeningBalanceListQuerySchema,
  OpeningBalanceListResponseSchema,
  OpeningBalanceSchema,
  PeriodListQuerySchema,
  PeriodListResponseSchema,
  UpdatePeriodRequestSchema,
  AccountingPeriodSchema,
  IdParamSchema,
  RELATIONSHIP_ERROR_CODES,
  type Account,
  type JournalEntry,
  type AccountingPeriod,
  type OpeningBalance,
  type TrialBalanceResponse,
} from './erp-4.js';
import {
  ERP4_EVENT_TYPES,
  createErp4Event,
} from './erp-4-events.js';
import type { EventEnvelope } from './events.js';

export const ERP4_MOCK_DEFAULT_PORT = 4014;

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic Seed Data Generator (100% Deterministic & Synthetic)
// ─────────────────────────────────────────────────────────────────────────────

export interface Erp4MockStore {
  accounts: Map<string, Account>;
  periods: Map<string, AccountingPeriod>;
  journalEntries: Map<string, JournalEntry>;
  openingBalances: Map<string, OpeningBalance>;
  emittedEvents: EventEnvelope[];
}

export function createInitialErp4MockData(): Erp4MockStore {
  const accounts = new Map<string, Account>();
  const periods = new Map<string, AccountingPeriod>();
  const journalEntries = new Map<string, JournalEntry>();
  const openingBalances = new Map<string, OpeningBalance>();

  // 1. Chart of Accounts (Synthetic Seed)
  const seedAccounts: Account[] = [
    {
      id: '11111111-0001-4000-8000-000000000001',
      code: '1010-CASH',
      name: 'Cash on Hand',
      type: 'asset',
      currency_code: 'INR',
      parent_id: null,
      description: 'Physical cash held at operational centers',
      is_active: true,
      is_posting_account: true,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
    },
    {
      id: '11111111-0001-4000-8000-000000000002',
      code: '1020-BANK',
      name: 'Operating Bank Account',
      type: 'asset',
      currency_code: 'INR',
      parent_id: null,
      description: 'Primary current account for operational transactions',
      is_active: true,
      is_posting_account: true,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
    },
    {
      id: '11111111-0001-4000-8000-000000000003',
      code: '1110-AR',
      name: 'Accounts Receivable',
      type: 'asset',
      currency_code: 'INR',
      parent_id: null,
      description: 'Trade receivables from customer sales invoices',
      is_active: true,
      is_posting_account: true,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
    },
    {
      id: '11111111-0001-4000-8000-000000000004',
      code: '2010-AP',
      name: 'Accounts Payable',
      type: 'liability',
      currency_code: 'INR',
      parent_id: null,
      description: 'Trade payables for vendor bills and purchases',
      is_active: true,
      is_posting_account: true,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
    },
    {
      id: '11111111-0001-4000-8000-000000000005',
      code: '4010-SALES',
      name: 'Sales Revenue',
      type: 'income',
      currency_code: 'INR',
      parent_id: null,
      description: 'Gross revenue from products and customer services',
      is_active: true,
      is_posting_account: true,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
    },
    {
      id: '11111111-0001-4000-8000-000000000006',
      code: '5010-SALARY',
      name: 'Payroll and Salary Expense',
      type: 'expense',
      currency_code: 'INR',
      parent_id: null,
      description: 'Monthly employee compensation and allowances',
      is_active: true,
      is_posting_account: true,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
    },
    {
      id: '11111111-0001-4000-8000-000000000007',
      code: '5020-SUPPLIES',
      name: 'Office Supplies Expense',
      type: 'expense',
      currency_code: 'INR',
      parent_id: null,
      description: 'Operational consumables and office equipment',
      is_active: true,
      is_posting_account: true,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
    },
    {
      id: '11111111-0001-4000-8000-000000000008',
      code: '1000-ASSET-HDR',
      name: 'Total Current Assets (Header)',
      type: 'asset',
      currency_code: 'INR',
      parent_id: null,
      description: 'Summary header account for asset categorization',
      is_active: true,
      is_posting_account: false, // Non-posting header account
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
    },
  ];
  for (const acc of seedAccounts) {
    accounts.set(acc.id, acc);
  }

  // 2. Accounting Periods (Synthetic Seed)
  const seedPeriods: AccountingPeriod[] = [
    {
      id: '22222222-0001-4000-8000-000000000001',
      period_label: '2026-04',
      start_date: '2026-04-01',
      end_date: '2026-04-30',
      status: 'open',
      fiscal_year: 'FY2026-27',
      closed_at: null,
      closed_by_user_id: null,
      created_at: '2026-04-01T00:00:00.000Z',
      updated_at: '2026-04-01T00:00:00.000Z',
    },
    {
      id: '22222222-0001-4000-8000-000000000002',
      period_label: '2026-03',
      start_date: '2026-03-01',
      end_date: '2026-03-31',
      status: 'soft_closed',
      fiscal_year: 'FY2025-26',
      closed_at: '2026-04-05T10:00:00.000Z',
      closed_by_user_id: '99999999-0001-4000-8000-000000000001',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-04-05T10:00:00.000Z',
    },
    {
      id: '22222222-0001-4000-8000-000000000003',
      period_label: '2026-02',
      start_date: '2026-02-01',
      end_date: '2026-02-28',
      status: 'locked',
      fiscal_year: 'FY2025-26',
      closed_at: '2026-03-10T09:00:00.000Z',
      closed_by_user_id: '99999999-0001-4000-8000-000000000001',
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-03-10T09:00:00.000Z',
    },
  ];
  for (const per of seedPeriods) {
    periods.set(per.id, per);
  }

  // 3. Opening Balances (Synthetic Seed)
  const seedOpeningBalances: OpeningBalance[] = [
    {
      id: '33333333-0001-4000-8000-000000000001',
      account_id: '11111111-0001-4000-8000-000000000002', // BANK
      currency_code: 'INR',
      balance_amount: '250000.0000',
      as_of_date: '2026-04-01',
      source_reference: 'MIGRATION-RUN-001',
      loaded_by_user_id: '99999999-0001-4000-8000-000000000001',
      created_at: '2026-04-01T00:00:00.000Z',
    },
  ];
  for (const ob of seedOpeningBalances) {
    openingBalances.set(ob.id, ob);
  }

  // 4. Balanced Journal Entries (Synthetic Seed: 1 Posted, 1 Draft)
  const seedJournals: JournalEntry[] = [
    {
      id: '44444444-0001-4000-8000-000000000001',
      entry_number: 'JV-2026-0001',
      period_id: '22222222-0001-4000-8000-000000000001',
      posting_date: '2026-04-10',
      status: 'posted',
      description: 'Synthetic: Customer payment for consulting invoice',
      currency_code: 'INR',
      source_reference: 'ERP3-INV-2026-001',
      idempotency_key: 'seed-post-001',
      created_by_user_id: '99999999-0001-4000-8000-000000000001',
      posted_by_user_id: '99999999-0001-4000-8000-000000000001',
      posted_at: '2026-04-10T11:00:00.000Z',
      reversed_by_entry_id: null,
      lines: [
        {
          id: '55555555-0001-4000-8000-000000000001',
          journal_entry_id: '44444444-0001-4000-8000-000000000001',
          account_id: '11111111-0001-4000-8000-000000000002', // BANK (Debit)
          debit_amount: '75000.0000',
          credit_amount: '0.0000',
          line_narration: 'Payment received in operating account',
          department_ref: 'DEP-SALES',
          created_at: '2026-04-10T10:30:00.000Z',
        },
        {
          id: '55555555-0001-4000-8000-000000000002',
          journal_entry_id: '44444444-0001-4000-8000-000000000001',
          account_id: '11111111-0001-4000-8000-000000000005', // SALES (Credit)
          debit_amount: '0.0000',
          credit_amount: '75000.0000',
          line_narration: 'Revenue recognised on services delivered',
          department_ref: 'DEP-SALES',
          created_at: '2026-04-10T10:30:00.000Z',
        },
      ],
      created_at: '2026-04-10T10:30:00.000Z',
      updated_at: '2026-04-10T11:00:00.000Z',
    },
    {
      id: '44444444-0001-4000-8000-000000000002',
      entry_number: 'JV-2026-0002',
      period_id: '22222222-0001-4000-8000-000000000001',
      posting_date: '2026-04-15',
      status: 'draft',
      description: 'Synthetic: Pending office stationery purchase',
      currency_code: 'INR',
      source_reference: 'ERP2-PO-2026-088',
      idempotency_key: 'seed-draft-002',
      created_by_user_id: '99999999-0001-4000-8000-000000000001',
      posted_by_user_id: null,
      posted_at: null,
      reversed_by_entry_id: null,
      lines: [
        {
          id: '55555555-0001-4000-8000-000000000003',
          journal_entry_id: '44444444-0001-4000-8000-000000000002',
          account_id: '11111111-0001-4000-8000-000000000007', // SUPPLIES (Debit)
          debit_amount: '12500.0000',
          credit_amount: '0.0000',
          line_narration: 'Stationery and supplies voucher',
          department_ref: 'DEP-ADMIN',
          created_at: '2026-04-15T09:00:00.000Z',
        },
        {
          id: '55555555-0001-4000-8000-000000000004',
          journal_entry_id: '44444444-0001-4000-8000-000000000002',
          account_id: '11111111-0001-4000-8000-000000000004', // AP (Credit)
          debit_amount: '0.0000',
          credit_amount: '12500.0000',
          line_narration: 'Vendor liability pending payment',
          department_ref: 'DEP-ADMIN',
          created_at: '2026-04-15T09:00:00.000Z',
        },
      ],
      created_at: '2026-04-15T09:00:00.000Z',
      updated_at: '2026-04-15T09:00:00.000Z',
    },
  ];
  for (const je of seedJournals) {
    journalEntries.set(je.id, je);
  }

  return {
    accounts,
    periods,
    journalEntries,
    openingBalances,
    emittedEvents: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fastify Deterministic Mock Plugin
// ─────────────────────────────────────────────────────────────────────────────

export interface Erp4MockPluginOptions {
  store?: Erp4MockStore;
  authRequired?: boolean;
}

export const erp4MockRoutes: FastifyPluginAsync<Erp4MockPluginOptions> = async (
  fastifyInstance,
  opts
) => {
  const store = opts.store ?? createInitialErp4MockData();
  const authRequired = opts.authRequired ?? false;

  // ── Error Envelope Handler (ADR-002) ───────────────────────────────────────
  fastifyInstance.setErrorHandler((error, request, reply) => {
    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ??
      (request.headers['x-request-id'] as string | undefined) ??
      randomUUID();
    reply.header('x-correlation-id', correlationId);

    if (error instanceof ZodError) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        code: 'VALIDATION_ERROR',
        message: error.issues[0]?.message ?? 'Contract validation failed',
        details: error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
        correlation_id: correlationId,
      });
    }

    const err = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
    const statusCode = typeof err['statusCode'] === 'number' ? err['statusCode'] : 500;
    const code = typeof err['code'] === 'string' ? err['code'] : 'INTERNAL_SERVER_ERROR';
    const message = typeof err['message'] === 'string' ? err['message'] : 'Internal mock error';

    return reply.status(statusCode).send({
      statusCode,
      error: statusCode === 400 ? 'Bad Request' : statusCode === 404 ? 'Not Found' : statusCode === 409 ? 'Conflict' : statusCode === 422 ? 'Unprocessable Entity' : 'Internal Server Error',
      code,
      message,
      details: Array.isArray(err['details']) ? err['details'] : [],
      correlation_id: correlationId,
    });
  });

  // ── Authentication & RBAC Guard Hook ───────────────────────────────────────
  fastifyInstance.addHook('onRequest', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (authRequired && !authHeader) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
        message: 'Missing Authorization header. Bearer token required.',
        details: [],
      });
    }

    if (authHeader) {
      if (!authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          code: 'UNAUTHORIZED',
          message: 'Invalid Authorization header format. Expected "Bearer <token>".',
          details: [],
        });
      }
      const token = authHeader.slice(7).trim();
      if (!token || token === 'invalid' || token === 'invalid-token' || token === 'expired') {
        return reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired bearer token.',
          details: [],
        });
      }
    }
  });

  // ── 1. ACCOUNTS ENDPOINTS ──────────────────────────────────────────────────

  // GET /accounts
  fastifyInstance.get('/accounts', async (req, reply) => {
    const query = AccountListQuerySchema.parse(req.query);
    let items = Array.from(store.accounts.values());

    if (query.type) {
      items = items.filter((a) => a.type === query.type);
    }
    if (query.is_active !== undefined) {
      items = items.filter((a) => a.is_active === query.is_active);
    }
    if (query.currency_code) {
      items = items.filter((a) => a.currency_code === query.currency_code);
    }
    if (query.search) {
      const s = query.search.toLowerCase();
      items = items.filter((a) => a.code.toLowerCase().includes(s) || a.name.toLowerCase().includes(s));
    }

    // Stable sort by code
    items.sort((a, b) => a.code.localeCompare(b.code));

    const total = items.length;
    const page = query.page;
    const pageSize = query.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);

    const response = {
      data: paged,
      total,
      page,
      pageSize,
      totalPages,
    };
    return reply.status(200).send(AccountListResponseSchema.parse(response));
  });

  // POST /accounts
  fastifyInstance.post('/accounts', async (req, reply) => {
    const body = CreateAccountRequestSchema.parse(req.body);

    // Natural Key duplicate check (UNIQUE code)
    const existingCode = Array.from(store.accounts.values()).find((a) => a.code === body.code);
    if (existingCode) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        code: 'ACCOUNT_CODE_EXISTS',
        message: `Account with code "${body.code}" already exists`,
        details: [{ field: 'code', code: 'DUPLICATE_CODE' }],
      });
    }

    // Parent account verification
    if (body.parent_id) {
      const parent = store.accounts.get(body.parent_id);
      if (!parent) {
        return reply.status(422).send({
          statusCode: 422,
          error: 'Unprocessable Entity',
          code: RELATIONSHIP_ERROR_CODES.PARENT_NOT_FOUND,
          message: `Parent account "${body.parent_id}" not found`,
          details: [{ field: 'parent_id', code: 'PARENT_NOT_FOUND' }],
        });
      }
      if (parent.currency_code !== (body.currency_code ?? 'INR')) {
        return reply.status(422).send({
          statusCode: 422,
          error: 'Unprocessable Entity',
          code: RELATIONSHIP_ERROR_CODES.CURRENCY_MISMATCH,
          message: 'Parent and child account currencies must match',
          details: [{ field: 'currency_code', code: 'CURRENCY_MISMATCH' }],
        });
      }
    }

    const now = new Date().toISOString();
    const newAccount: Account = {
      id: randomUUID(),
      code: body.code,
      name: body.name,
      type: body.type,
      currency_code: body.currency_code ?? 'INR',
      parent_id: body.parent_id ?? null,
      description: body.description ?? null,
      is_active: true,
      is_posting_account: body.is_posting_account ?? true,
      created_at: now,
      updated_at: now,
    };

    store.accounts.set(newAccount.id, newAccount);

    // Emit AccountCreated event
    const event = createErp4Event({
      event_type: ERP4_EVENT_TYPES.ACCOUNT_CREATED,
      correlation_id: (req.headers['x-correlation-id'] as string) ?? randomUUID(),
      entity_type: 'account',
      entity_id: newAccount.id,
      batch_id: body.batch_id ?? undefined,
      payload: {
        id: newAccount.id,
        code: newAccount.code,
        name: newAccount.name,
        type: newAccount.type,
        currency_code: newAccount.currency_code,
        is_posting_account: newAccount.is_posting_account,
        is_active: newAccount.is_active,
        parent_id: newAccount.parent_id,
      },
    });
    store.emittedEvents.push(event);

    return reply.status(201).send(AccountSchema.parse(newAccount));
  });

  // GET /accounts/:id
  fastifyInstance.get('/accounts/:id', async (req, reply) => {
    const { id } = IdParamSchema.parse(req.params);
    const account = store.accounts.get(id);
    if (!account) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        code: 'ACCOUNT_NOT_FOUND',
        message: `Account with ID "${id}" was not found`,
      });
    }
    return reply.status(200).send(AccountSchema.parse(account));
  });

  // PATCH /accounts/:id
  fastifyInstance.patch('/accounts/:id', async (req, reply) => {
    const { id } = IdParamSchema.parse(req.params);
    const body = UpdateAccountRequestSchema.parse(req.body);
    const account = store.accounts.get(id);
    if (!account) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        code: 'ACCOUNT_NOT_FOUND',
        message: `Account with ID "${id}" was not found`,
      });
    }

    if (body.parent_id) {
      if (body.parent_id === id) {
        return reply.status(422).send({
          statusCode: 422,
          error: 'Unprocessable Entity',
          code: RELATIONSHIP_ERROR_CODES.CYCLE_DETECTED,
          message: 'An account cannot be its own parent',
        });
      }
      const parent = store.accounts.get(body.parent_id);
      if (!parent) {
        return reply.status(422).send({
          statusCode: 422,
          error: 'Unprocessable Entity',
          code: RELATIONSHIP_ERROR_CODES.PARENT_NOT_FOUND,
          message: `Parent account "${body.parent_id}" not found`,
        });
      }
    }

    const updatedAccount: Account = {
      ...account,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.is_active !== undefined ? { is_active: body.is_active } : {}),
      ...(body.is_posting_account !== undefined ? { is_posting_account: body.is_posting_account } : {}),
      ...(body.parent_id !== undefined ? { parent_id: body.parent_id } : {}),
      updated_at: new Date().toISOString(),
    };

    store.accounts.set(id, updatedAccount);

    // Emit AccountUpdated event
    const event = createErp4Event({
      event_type: ERP4_EVENT_TYPES.ACCOUNT_UPDATED,
      correlation_id: (req.headers['x-correlation-id'] as string) ?? randomUUID(),
      entity_type: 'account',
      entity_id: updatedAccount.id,
      payload: {
        id: updatedAccount.id,
        code: updatedAccount.code,
        name: updatedAccount.name,
        type: updatedAccount.type,
        currency_code: updatedAccount.currency_code,
        is_active: updatedAccount.is_active,
        is_posting_account: updatedAccount.is_posting_account,
        parent_id: updatedAccount.parent_id,
      },
    });
    store.emittedEvents.push(event);

    return reply.status(200).send(AccountSchema.parse(updatedAccount));
  });

  // ── 2. JOURNAL ENTRIES ENDPOINTS ───────────────────────────────────────────

  // GET /journal-entries
  fastifyInstance.get('/journal-entries', async (req, reply) => {
    const query = JournalEntryListQuerySchema.parse(req.query);
    let items = Array.from(store.journalEntries.values());

    if (query.period) {
      const per = Array.from(store.periods.values()).find((p) => p.period_label === query.period);
      if (per) {
        items = items.filter((j) => j.period_id === per.id);
      } else {
        items = [];
      }
    }
    if (query.period_id) {
      items = items.filter((j) => j.period_id === query.period_id);
    }
    if (query.status) {
      items = items.filter((j) => j.status === query.status);
    }
    if (query.from_date) {
      items = items.filter((j) => j.posting_date >= query.from_date!);
    }
    if (query.to_date) {
      items = items.filter((j) => j.posting_date <= query.to_date!);
    }
    if (query.currency_code) {
      items = items.filter((j) => j.currency_code === query.currency_code);
    }
    if (query.search) {
      const s = query.search.toLowerCase();
      items = items.filter((j) => j.entry_number.toLowerCase().includes(s) || j.description.toLowerCase().includes(s));
    }

    // Stable sort by posting_date desc, created_at desc
    items.sort((a, b) => b.posting_date.localeCompare(a.posting_date) || b.created_at.localeCompare(a.created_at));

    const total = items.length;
    const page = query.page;
    const pageSize = query.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);

    const response = {
      data: paged,
      total,
      page,
      pageSize,
      limit: pageSize,
      totalPages,
    };
    return reply.status(200).send(JournalEntryListResponseSchema.parse(response));
  });

  // POST /journal-entries (Create Draft)
  fastifyInstance.post('/journal-entries', async (req, reply) => {
    const body = CreateJournalEntryRequestSchema.parse(req.body);

    // Idempotent duplicate check
    if (body.idempotency_key) {
      const existing = Array.from(store.journalEntries.values()).find((j) => j.idempotency_key === body.idempotency_key);
      if (existing) {
        return reply.status(200).send(JournalEntrySchema.parse(existing));
      }
    }

    // Verify accounting period exists and is not locked
    const period = store.periods.get(body.period_id);
    if (!period) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: RELATIONSHIP_ERROR_CODES.PERIOD_NOT_FOUND,
        message: `Accounting period "${body.period_id}" was not found`,
      });
    }
    if (period.status === 'locked') {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: RELATIONSHIP_ERROR_CODES.PERIOD_LOCKED,
        message: `Fiscal period "${period.period_label}" is locked against postings`,
      });
    }

    // Validate account lines against existing chart of accounts
    for (const line of body.lines) {
      const acc = store.accounts.get(line.account_id);
      if (!acc) {
        return reply.status(422).send({
          statusCode: 422,
          error: 'Unprocessable Entity',
          code: RELATIONSHIP_ERROR_CODES.ACCOUNT_NOT_FOUND,
          message: `Account "${line.account_id}" does not exist`,
        });
      }
      if (!acc.is_active) {
        return reply.status(422).send({
          statusCode: 422,
          error: 'Unprocessable Entity',
          code: RELATIONSHIP_ERROR_CODES.ACCOUNT_INACTIVE,
          message: `Account "${acc.code}" is inactive and rejects postings`,
        });
      }
      if (!acc.is_posting_account) {
        return reply.status(422).send({
          statusCode: 422,
          error: 'Unprocessable Entity',
          code: RELATIONSHIP_ERROR_CODES.CANNOT_POST_TO_HEADER_ACCOUNT,
          message: `Account "${acc.code}" is a header account; only leaf posting accounts accept entries`,
        });
      }
    }

    const now = new Date().toISOString();
    const journalId = randomUUID();
    const entrySeq = store.journalEntries.size + 1;
    const entryNumber = `JV-2026-${String(entrySeq).padStart(4, '0')}`;

    const lines = body.lines.map((l) => ({
      id: randomUUID(),
      journal_entry_id: journalId,
      account_id: l.account_id,
      debit_amount: l.debit_amount,
      credit_amount: l.credit_amount,
      line_narration: l.line_narration ?? null,
      department_ref: l.department_ref ?? null,
      created_at: now,
    }));

    const newEntry: JournalEntry = {
      id: journalId,
      entry_number: entryNumber,
      period_id: body.period_id,
      posting_date: body.posting_date,
      status: 'draft',
      description: body.description,
      currency_code: body.currency_code,
      source_reference: body.source_reference ?? null,
      idempotency_key: body.idempotency_key ?? null,
      created_by_user_id: '99999999-0001-4000-8000-000000000001',
      posted_by_user_id: null,
      posted_at: null,
      reversed_by_entry_id: null,
      lines,
      created_at: now,
      updated_at: now,
    };

    store.journalEntries.set(newEntry.id, newEntry);

    // Calculate total debits
    const totalDebit = lines.reduce((sum, l) => sum + parseFloat(l.debit_amount), 0).toFixed(4);

    // Emit JournalEntryCreated event
    const event = createErp4Event({
      event_type: ERP4_EVENT_TYPES.JOURNAL_ENTRY_CREATED,
      correlation_id: (req.headers['x-correlation-id'] as string) ?? randomUUID(),
      entity_type: 'journal_entry',
      entity_id: newEntry.id,
      batch_id: body.batch_id ?? undefined,
      payload: {
        id: newEntry.id,
        entry_number: newEntry.entry_number,
        period_id: newEntry.period_id,
        posting_date: newEntry.posting_date,
        status: 'draft',
        description: newEntry.description,
        currency_code: newEntry.currency_code,
        line_count: lines.length,
        total_debit: totalDebit,
        total_credit: totalDebit,
      },
    });
    store.emittedEvents.push(event);

    return reply.status(201).send(JournalEntrySchema.parse(newEntry));
  });

  // GET /journal-entries/:id
  fastifyInstance.get('/journal-entries/:id', async (req, reply) => {
    const { id } = IdParamSchema.parse(req.params);
    const entry = store.journalEntries.get(id);
    if (!entry) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        code: 'JOURNAL_ENTRY_NOT_FOUND',
        message: `Journal entry "${id}" was not found`,
      });
    }
    return reply.status(200).send(JournalEntrySchema.parse(entry));
  });

  // PATCH /journal-entries/:id (Update Draft)
  fastifyInstance.patch('/journal-entries/:id', async (req, reply) => {
    const { id } = IdParamSchema.parse(req.params);
    const body = UpdateJournalEntryRequestSchema.parse(req.body);
    const entry = store.journalEntries.get(id);
    if (!entry) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        code: 'JOURNAL_ENTRY_NOT_FOUND',
        message: `Journal entry "${id}" was not found`,
      });
    }

    if (entry.status !== 'draft') {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: RELATIONSHIP_ERROR_CODES.ENTRY_IMMUTABLE,
        message: `Journal entry is in "${entry.status}" status and cannot be modified. Only draft entries are mutable.`,
      });
    }

    const now = new Date().toISOString();
    let updatedLines = entry.lines;
    if (body.lines) {
      updatedLines = body.lines.map((l) => ({
        id: randomUUID(),
        journal_entry_id: id,
        account_id: l.account_id,
        debit_amount: l.debit_amount,
        credit_amount: l.credit_amount,
        line_narration: l.line_narration ?? null,
        department_ref: l.department_ref ?? null,
        created_at: now,
      }));
    }

    const updatedEntry: JournalEntry = {
      ...entry,
      ...(body.posting_date !== undefined ? { posting_date: body.posting_date } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.period_id !== undefined ? { period_id: body.period_id } : {}),
      lines: updatedLines,
      updated_at: now,
    };

    store.journalEntries.set(id, updatedEntry);
    return reply.status(200).send(JournalEntrySchema.parse(updatedEntry));
  });

  // POST /journal-entries/:id/post (Post Draft)
  fastifyInstance.post('/journal-entries/:id/post', async (req, reply) => {
    const { id } = IdParamSchema.parse(req.params);
    const entry = store.journalEntries.get(id);
    if (!entry) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        code: 'JOURNAL_ENTRY_NOT_FOUND',
        message: `Journal entry "${id}" was not found`,
      });
    }

    if (entry.status === 'posted') {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        code: 'ENTRY_ALREADY_POSTED',
        message: `Journal entry "${entry.entry_number}" is already posted`,
      });
    }

    if (entry.status !== 'draft') {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: RELATIONSHIP_ERROR_CODES.INVALID_STATUS_TRANSITION,
        message: `Cannot post entry in "${entry.status}" status`,
      });
    }

    // Verify period status
    const period = store.periods.get(entry.period_id);
    if (!period || period.status === 'locked') {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: RELATIONSHIP_ERROR_CODES.PERIOD_LOCKED,
        message: `Period is locked against postings`,
      });
    }

    // Double-check balancing invariant (BR-ERP4-01)
    const totalDebit = entry.lines.reduce((sum, l) => sum + Math.round(parseFloat(l.debit_amount) * 10000), 0);
    const totalCredit = entry.lines.reduce((sum, l) => sum + Math.round(parseFloat(l.credit_amount) * 10000), 0);
    if (totalDebit !== totalCredit || totalDebit <= 0) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: 'JOURNAL_UNBALANCED',
        message: `Journal entry debits (${totalDebit / 10000}) must equal credits (${totalCredit / 10000}) at currency precision`,
      });
    }

    const now = new Date().toISOString();
    const postedEntry: JournalEntry = {
      ...entry,
      status: 'posted',
      posted_at: now,
      posted_by_user_id: '99999999-0001-4000-8000-000000000001',
      updated_at: now,
    };

    store.journalEntries.set(id, postedEntry);

    // Emit JournalEntryPosted event
    const event = createErp4Event({
      event_type: ERP4_EVENT_TYPES.JOURNAL_ENTRY_POSTED,
      correlation_id: (req.headers['x-correlation-id'] as string) ?? randomUUID(),
      entity_type: 'journal_entry',
      entity_id: postedEntry.id,
      payload: {
        id: postedEntry.id,
        entry_number: postedEntry.entry_number,
        period_id: postedEntry.period_id,
        posting_date: postedEntry.posting_date,
        status: 'posted',
        description: postedEntry.description,
        currency_code: postedEntry.currency_code,
        posted_at: now,
        posted_by_user_id: postedEntry.posted_by_user_id!,
        total_amount: (totalDebit / 10000).toFixed(4),
        line_count: postedEntry.lines.length,
      },
    });
    store.emittedEvents.push(event);

    return reply.status(200).send(JournalEntrySchema.parse(postedEntry));
  });

  // POST /journal-entries/:id/reverse (Compensating Reversal)
  fastifyInstance.post('/journal-entries/:id/reverse', async (req, reply) => {
    const { id } = IdParamSchema.parse(req.params);
    const body = ReverseJournalEntryRequestSchema.parse(req.body ?? {});
    const entry = store.journalEntries.get(id);
    if (!entry) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        code: 'JOURNAL_ENTRY_NOT_FOUND',
        message: `Journal entry "${id}" was not found`,
      });
    }

    if (entry.status !== 'posted') {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        code: RELATIONSHIP_ERROR_CODES.NOT_REVERSIBLE,
        message: `Only posted entries can be reversed. Current status: "${entry.status}"`,
      });
    }

    const now = new Date().toISOString();
    const reversalId = randomUUID();
    const reversalEntryNumber = `REV-${entry.entry_number}`;

    // Swap debits and credits
    const reversalLines = entry.lines.map((l) => ({
      id: randomUUID(),
      journal_entry_id: reversalId,
      account_id: l.account_id,
      debit_amount: l.credit_amount,
      credit_amount: l.debit_amount,
      line_narration: `Reversal of line ${l.id}`,
      department_ref: l.department_ref,
      created_at: now,
    }));

    const reversalEntry: JournalEntry = {
      id: reversalId,
      entry_number: reversalEntryNumber,
      period_id: entry.period_id,
      posting_date: body.reversal_date ?? entry.posting_date,
      status: 'posted',
      description: body.reversal_description ?? `Reversal of ${entry.entry_number}: ${entry.description}`,
      currency_code: entry.currency_code,
      source_reference: `REV:${entry.entry_number}`,
      idempotency_key: `reversal-${entry.id}`,
      created_by_user_id: '99999999-0001-4000-8000-000000000001',
      posted_by_user_id: '99999999-0001-4000-8000-000000000001',
      posted_at: now,
      reversed_by_entry_id: null,
      lines: reversalLines,
      created_at: now,
      updated_at: now,
    };

    store.journalEntries.set(reversalId, reversalEntry);

    // Update original entry to 'reversed' and link to reversal
    const updatedOriginal: JournalEntry = {
      ...entry,
      status: 'reversed',
      reversed_by_entry_id: reversalId,
      updated_at: now,
    };
    store.journalEntries.set(id, updatedOriginal);

    const totalAmount = reversalLines.reduce((sum, l) => sum + parseFloat(l.debit_amount), 0).toFixed(4);

    // Emit JournalEntryReversed event
    const event = createErp4Event({
      event_type: ERP4_EVENT_TYPES.JOURNAL_ENTRY_REVERSED,
      correlation_id: (req.headers['x-correlation-id'] as string) ?? randomUUID(),
      entity_type: 'journal_entry',
      entity_id: entry.id,
      payload: {
        original_entry_id: entry.id,
        original_entry_number: entry.entry_number,
        reversal_entry_id: reversalId,
        reversal_entry_number: reversalEntryNumber,
        reversal_date: reversalEntry.posting_date,
        currency_code: entry.currency_code,
        total_amount: totalAmount,
        reason: body.reversal_description,
      },
    });
    store.emittedEvents.push(event);

    return reply.status(201).send(JournalEntrySchema.parse(reversalEntry));
  });

  // POST /journal-entries/:id/void (Void Draft)
  fastifyInstance.post('/journal-entries/:id/void', async (req, reply) => {
    const { id } = IdParamSchema.parse(req.params);
    const entry = store.journalEntries.get(id);
    if (!entry) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        code: 'JOURNAL_ENTRY_NOT_FOUND',
        message: `Journal entry "${id}" was not found`,
      });
    }

    if (entry.status !== 'draft') {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: RELATIONSHIP_ERROR_CODES.ENTRY_IMMUTABLE,
        message: `Only draft entries can be voided. Current status: "${entry.status}"`,
      });
    }

    const now = new Date().toISOString();
    const voidedEntry: JournalEntry = {
      ...entry,
      status: 'voided',
      updated_at: now,
    };
    store.journalEntries.set(id, voidedEntry);

    // Emit JournalEntryVoided event
    const event = createErp4Event({
      event_type: ERP4_EVENT_TYPES.JOURNAL_ENTRY_VOIDED,
      correlation_id: (req.headers['x-correlation-id'] as string) ?? randomUUID(),
      entity_type: 'journal_entry',
      entity_id: id,
      payload: {
        id,
        entry_number: entry.entry_number,
        voided_at: now,
      },
    });
    store.emittedEvents.push(event);

    return reply.status(200).send(JournalEntrySchema.parse(voidedEntry));
  });

  // ── 3. TRIAL BALANCE ENDPOINT ──────────────────────────────────────────────

  // GET /trial-balance?period=YYYY-MM
  fastifyInstance.get('/trial-balance', async (req, reply) => {
    const query = TrialBalanceQuerySchema.parse(req.query);
    const targetPeriod = Array.from(store.periods.values()).find((p) => p.period_label === query.period);
    if (!targetPeriod) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        code: 'PERIOD_NOT_FOUND',
        message: `Fiscal period "${query.period}" was not found`,
      });
    }

    // Filter posted journal entries within the period
    const postedEntries = Array.from(store.journalEntries.values()).filter(
      (j) => j.period_id === targetPeriod.id && (j.status === 'posted' || j.status === 'reversed')
    );

    const accountTotals = new Map<string, { totalDebit: number; totalCredit: number }>();
    for (const entry of postedEntries) {
      for (const line of entry.lines) {
        const cur = accountTotals.get(line.account_id) ?? { totalDebit: 0, totalCredit: 0 };
        cur.totalDebit += Math.round(parseFloat(line.debit_amount) * 10000);
        cur.totalCredit += Math.round(parseFloat(line.credit_amount) * 10000);
        accountTotals.set(line.account_id, cur);
      }
    }

    let overallDebit = 0;
    let overallCredit = 0;
    const rows = Array.from(store.accounts.values())
      .filter((a) => a.is_posting_account && (!query.currency_code || a.currency_code === query.currency_code))
      .map((acc) => {
        const debCred = accountTotals.get(acc.id) ?? { totalDebit: 0, totalCredit: 0 };
        const debitStr = (debCred.totalDebit / 10000).toFixed(4);
        const creditStr = (debCred.totalCredit / 10000).toFixed(4);
        const net = (debCred.totalDebit - debCred.totalCredit) / 10000;

        // Opening balance for this account
        const ob = Array.from(store.openingBalances.values()).find((o) => o.account_id === acc.id);
        const obVal = ob ? parseFloat(ob.balance_amount) : 0;
        const closingVal = obVal + net;

        overallDebit += debCred.totalDebit;
        overallCredit += debCred.totalCredit;

        return {
          account_id: acc.id,
          account_code: acc.code,
          account_name: acc.name,
          account_type: acc.type,
          currency_code: acc.currency_code,
          total_debit: debitStr,
          total_credit: creditStr,
          net_balance: net.toFixed(4),
          opening_balance: obVal.toFixed(4),
          closing_balance: closingVal.toFixed(4),
        };
      });

    const diff = ((overallDebit - overallCredit) / 10000).toFixed(4);
    const trialBalanceResponse: TrialBalanceResponse = {
      period: query.period,
      generated_at: new Date().toISOString(),
      rows,
      totals: {
        total_debit: (overallDebit / 10000).toFixed(4),
        total_credit: (overallCredit / 10000).toFixed(4),
        difference: diff,
        is_balanced: overallDebit === overallCredit,
      },
    };

    return reply.status(200).send(TrialBalanceResponseSchema.parse(trialBalanceResponse));
  });

  // ── 4. OPENING BALANCES ENDPOINTS ──────────────────────────────────────────

  // POST /opening-balances
  fastifyInstance.post('/opening-balances', async (req, reply) => {
    const body = CreateOpeningBalancesRequestSchema.parse(req.body);
    const created: OpeningBalance[] = [];
    const skipped: Array<{ account_id: string; currency_code: string; reason: string }> = [];

    const now = new Date().toISOString();
    for (const item of body.balances) {
      // Check account exists
      const acc = store.accounts.get(item.account_id);
      if (!acc) {
        skipped.push({
          account_id: item.account_id,
          currency_code: item.currency_code,
          reason: 'ACCOUNT_NOT_FOUND',
        });
        continue;
      }

      // Check unique (account_id, currency_code)
      const existing = Array.from(store.openingBalances.values()).find(
        (ob) => ob.account_id === item.account_id && ob.currency_code === item.currency_code
      );
      if (existing) {
        skipped.push({
          account_id: item.account_id,
          currency_code: item.currency_code,
          reason: RELATIONSHIP_ERROR_CODES.DUPLICATE_OPENING_BALANCE,
        });
        continue;
      }

      const newOb: OpeningBalance = {
        id: randomUUID(),
        account_id: item.account_id,
        currency_code: item.currency_code,
        balance_amount: item.balance_amount,
        as_of_date: item.as_of_date,
        source_reference: item.source_reference ?? null,
        loaded_by_user_id: '99999999-0001-4000-8000-000000000001',
        created_at: now,
      };

      store.openingBalances.set(newOb.id, newOb);
      created.push(newOb);

      // Emit OpeningBalanceCreated event
      const event = createErp4Event({
        event_type: ERP4_EVENT_TYPES.OPENING_BALANCE_CREATED,
        correlation_id: (req.headers['x-correlation-id'] as string) ?? randomUUID(),
        entity_type: 'opening_balance',
        entity_id: newOb.id,
        batch_id: item.batch_id ?? undefined,
        payload: {
          id: newOb.id,
          account_id: newOb.account_id,
          currency_code: newOb.currency_code,
          balance_amount: newOb.balance_amount,
          as_of_date: newOb.as_of_date,
          source_reference: newOb.source_reference,
        },
      });
      store.emittedEvents.push(event);
    }

    return reply.status(201).send(
      CreateOpeningBalancesResponseSchema.parse({
        created,
        skipped,
      })
    );
  });

  // GET /opening-balances
  fastifyInstance.get('/opening-balances', async (req, reply) => {
    const query = OpeningBalanceListQuerySchema.parse(req.query);
    let items = Array.from(store.openingBalances.values());

    if (query.account_id) {
      items = items.filter((o) => o.account_id === query.account_id);
    }
    if (query.currency_code) {
      items = items.filter((o) => o.currency_code === query.currency_code);
    }

    const total = items.length;
    const page = query.page;
    const pageSize = query.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);

    return reply.status(200).send(
      OpeningBalanceListResponseSchema.parse({
        data: paged,
        total,
        page,
        pageSize,
        totalPages,
      })
    );
  });

  // GET /opening-balances/:id
  fastifyInstance.get('/opening-balances/:id', async (req, reply) => {
    const { id } = IdParamSchema.parse(req.params);
    const ob = store.openingBalances.get(id);
    if (!ob) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        code: 'OPENING_BALANCE_NOT_FOUND',
        message: `Opening balance "${id}" was not found`,
      });
    }
    return reply.status(200).send(OpeningBalanceSchema.parse(ob));
  });

  // ── 5. PERIODS ENDPOINTS ───────────────────────────────────────────────────

  // GET /periods
  fastifyInstance.get('/periods', async (req, reply) => {
    const query = PeriodListQuerySchema.parse(req.query);
    let items = Array.from(store.periods.values());

    if (query.status) {
      items = items.filter((p) => p.status === query.status);
    }
    if (query.fiscal_year) {
      items = items.filter((p) => p.fiscal_year === query.fiscal_year);
    }

    // Sort by start_date desc
    items.sort((a, b) => b.start_date.localeCompare(a.start_date));

    const total = items.length;
    const page = query.page;
    const pageSize = query.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);

    return reply.status(200).send(
      PeriodListResponseSchema.parse({
        data: paged,
        total,
        page,
        pageSize,
        totalPages,
      })
    );
  });

  // GET /periods/:id
  fastifyInstance.get('/periods/:id', async (req, reply) => {
    const { id } = IdParamSchema.parse(req.params);
    const period = store.periods.get(id);
    if (!period) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        code: 'PERIOD_NOT_FOUND',
        message: `Period "${id}" was not found`,
      });
    }
    return reply.status(200).send(AccountingPeriodSchema.parse(period));
  });

  // PATCH /periods/:id (Status Transition)
  fastifyInstance.patch('/periods/:id', async (req, reply) => {
    const { id } = IdParamSchema.parse(req.params);
    const body = UpdatePeriodRequestSchema.parse(req.body);
    const period = store.periods.get(id);
    if (!period) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        code: 'PERIOD_NOT_FOUND',
        message: `Period "${id}" was not found`,
      });
    }

    // FSM rule: locked is terminal
    if (period.status === 'locked' && body.status && body.status !== 'locked') {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: RELATIONSHIP_ERROR_CODES.INVALID_PERIOD_TRANSITION,
        message: `Locked accounting periods are permanent and cannot be reopened`,
      });
    }

    const previousStatus = period.status;
    const newStatus = body.status ?? period.status;
    const now = new Date().toISOString();

    const updatedPeriod: AccountingPeriod = {
      ...period,
      status: newStatus,
      closed_at: newStatus === 'open' ? null : now,
      closed_by_user_id: newStatus === 'open' ? null : '99999999-0001-4000-8000-000000000001',
      updated_at: now,
    };
    store.periods.set(id, updatedPeriod);

    // Emit PeriodStatusChanged event
    const event = createErp4Event({
      event_type: ERP4_EVENT_TYPES.PERIOD_STATUS_CHANGED,
      correlation_id: (req.headers['x-correlation-id'] as string) ?? randomUUID(),
      entity_type: 'accounting_period',
      entity_id: id,
      payload: {
        id,
        period_label: updatedPeriod.period_label,
        previous_status: previousStatus,
        new_status: newStatus,
        fiscal_year: updatedPeriod.fiscal_year,
        changed_at: now,
        changed_by_user_id: '99999999-0001-4000-8000-000000000001',
      },
    });
    store.emittedEvents.push(event);

    return reply.status(200).send(AccountingPeriodSchema.parse(updatedPeriod));
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Standalone Server Factory for In-Process Testing and Standalone CLI
// ─────────────────────────────────────────────────────────────────────────────

export interface Erp4MockServerInstance {
  app: FastifyInstance;
  store: Erp4MockStore;
  reset: () => void;
  start: (port?: number, host?: string) => Promise<string>;
  stop: () => Promise<void>;
}

export function createErp4MockServer(options: Erp4MockPluginOptions = {}): Erp4MockServerInstance {
  const store = options.store ?? createInitialErp4MockData();
  const app = fastify({ logger: false });

  app.register(erp4MockRoutes, {
    prefix: '/api/v1/erp-finance',
    store,
    authRequired: options.authRequired ?? false,
  });

  return {
    app,
    store,
    reset: () => {
      const fresh = createInitialErp4MockData();
      store.accounts = fresh.accounts;
      store.periods = fresh.periods;
      store.journalEntries = fresh.journalEntries;
      store.openingBalances = fresh.openingBalances;
      store.emittedEvents = [];
    },
    start: async (port: number = ERP4_MOCK_DEFAULT_PORT, host: string = '0.0.0.0') => {
      await app.listen({ port, host });
      return `http://${host}:${port}/api/v1/erp-finance`;
    },
    stop: async () => {
      await app.close();
    },
  };
}
