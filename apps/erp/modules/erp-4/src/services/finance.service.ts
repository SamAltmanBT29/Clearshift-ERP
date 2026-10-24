/**
 * ERP-4 Finance & Accounting — Domain Service
 *
 * Implements business rules, coordinates repository operations, and enforces domain invariants:
 *   - Chart of Accounts & Hierarchy (FR-ERP4-01)
 *   - Journal Entries & double-entry balance checks (FR-ERP4-02, BR-ERP4-01)
 *   - Accounting Period posting guard & transitions (BR-ERP4-02)
 *   - Trial Balance report generation & read consistency (FR-ERP4-03)
 *   - One-time opening balances (FR-ERP4-04)
 *   - Cross-module referential integrity via ReferenceResolver (Decision C7)
 *
 * @module erp4/services/finance.service
 */

import { randomUUID } from 'node:crypto';
import type {
  Account,
  CreateAccountRequest,
  UpdateAccountRequest,
  AccountListQuery,
  AccountListResponse,
  JournalEntry,
  CreateJournalEntryRequest,
  UpdateJournalEntryRequest,
  JournalEntryListQuery,
  JournalEntryListResponse,
  ReverseJournalEntryRequest,
  TrialBalanceQuery,
  TrialBalanceResponse,
  TrialBalanceRow,
  OpeningBalance,
  CreateOpeningBalancesRequest,
  CreateOpeningBalancesResponse,
  OpeningBalanceListQuery,
  OpeningBalanceListResponse,
  AccountingPeriod,
  PeriodListQuery,
  PeriodListResponse,
  ImportReceipt,
  UpdatePeriodRequest,
  RelationshipWarning,
  ImportRowRequest,
  ImportRowResponse,
} from '@clearshift/contracts';
import {
  assertDoubleEntryBalanced,
  assertJournalLineValid,
  assertEntryIsEditable,
  computeTrialBalance,
  computeTrialBalanceTotals,
  DomainError,
} from '../../domain/engine.js';
import {
  RELATIONSHIP_ERROR_CODES,
  assertJournalEntryTransition,
  assertPeriodTransition,
  validateAccountParent,
  validateJournalLineAccount,
  validateJournalEntryPeriod,
  validateCrossModuleReference,
  assertValidAccountType,
  assertValidPeriodStatus,
  assertJournalEntryReadConsistency,
  assertTrialBalanceReadConsistency,
  handleOptionalRelationship,
} from '../domain/relationships.js';
import type { ReferenceResolver } from '@cs/kernel';
import type { FinanceRepository } from './repository.js';
import { InMemoryFinanceRepository, computeRequestHash } from './repository.js';
import { Erp4AuditService } from './audit.js';

// ─────────────────────────────────────────────────────────────────────────────
// Service Errors
// ─────────────────────────────────────────────────────────────────────────────

export class ServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly error: string,
    message: string,
    public readonly details: unknown[] = [],
    public readonly code: string = 'SERVICE_ERROR'
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export class NotFoundError extends ServiceError {
  constructor(entity: string, id: string, details: unknown[] = [], code: string = 'NOT_FOUND') {
    super(404, 'Not Found', `${entity} with identifier "${id}" was not found.`, details, code);
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string, details: unknown[] = [], code: string = 'CONFLICT') {
    super(409, 'Conflict', message, details, code);
  }
}

export class IdempotencyConflictError extends ServiceError {
  constructor(message: string, details: unknown[] = []) {
    super(409, 'Conflict', message, details, 'IDEMPOTENCY_CONFLICT');
  }
}

export class BadRequestError extends ServiceError {
  constructor(message: string, details: unknown[] = [], code: string = 'BAD_REQUEST') {
    super(400, 'Bad Request', message, details, code);
  }
}

export class UnprocessableError extends ServiceError {
  constructor(message: string, details: unknown[] = [], code: string = 'UNPROCESSABLE_ENTITY') {
    super(422, 'Unprocessable Entity', message, details, code);
  }
}

export class ForbiddenError extends ServiceError {
  constructor(message: string = 'Forbidden', code: string = 'FORBIDDEN') {
    super(403, 'Forbidden', message, [], code);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Finance Service
// ─────────────────────────────────────────────────────────────────────────────

export interface FinanceServiceDependencies {
  repository?: FinanceRepository | undefined;
  referenceResolver?: ReferenceResolver | undefined;
  auditService?: Erp4AuditService | undefined;
}

export class FinanceService {
  private readonly repository: FinanceRepository;
  private readonly referenceResolver?: ReferenceResolver | undefined;
  public readonly auditService: Erp4AuditService;

  constructor(
    repoOrDeps: FinanceRepository | FinanceServiceDependencies = new InMemoryFinanceRepository(),
    referenceResolver?: ReferenceResolver,
    auditService?: Erp4AuditService
  ) {
    if ('listAccounts' in repoOrDeps) {
      this.repository = repoOrDeps;
      this.referenceResolver = referenceResolver;
      this.auditService = auditService ?? new Erp4AuditService();
    } else {
      this.repository = repoOrDeps.repository ?? new InMemoryFinanceRepository();
      this.referenceResolver = repoOrDeps.referenceResolver ?? referenceResolver;
      this.auditService = repoOrDeps.auditService ?? auditService ?? new Erp4AuditService();
    }
  }

  // ── Accounts (Chart of Accounts) ───────────────────────────────────────────

  async listAccounts(query: AccountListQuery): Promise<AccountListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const { accounts, total } = await this.repository.listAccounts({
      ...query,
      page,
      pageSize,
    });

    const totalPages = Math.ceil(total / pageSize) || 1;

    return {
      data: accounts,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  async getAccountById(id: string): Promise<Account> {
    const account = await this.repository.getAccountById(id);
    if (!account) {
      throw new NotFoundError('Account', id);
    }
    return account;
  }

  async createAccount(
    data: CreateAccountRequest
  ): Promise<{ account: Account; created: boolean; receipt?: ImportReceipt; warning?: RelationshipWarning }> {
    // 0. Validate account type enumeration
    assertValidAccountType(data.type);

    // 1. Idempotency check
    if (data.idempotency_key) {
      const receipt = await this.repository.getImportReceiptByIdempotencyKey(data.idempotency_key);
      if (receipt) {
        const target = await this.repository.getAccountById(receipt.target_id);
        if (target) {
          if (target.code.toLowerCase() !== data.code.toLowerCase()) {
            throw new IdempotencyConflictError(
              `Idempotency key "${data.idempotency_key}" was previously used for account "${target.code}".`,
              [{ field: 'idempotency_key', message: 'Conflicting idempotency key', code: 'IDEMPOTENCY_CONFLICT' }]
            );
          }
          return { account: target, created: false, receipt };
        }
      }
    }

    // 2. Code uniqueness (FR-ERP4-01)
    const existing = await this.repository.getAccountByCode(data.code);
    if (existing) {
      throw new ConflictError(
        `Account with code "${data.code}" already exists.`,
        [{ field: 'code', message: `Account code "${data.code}" is already in use`, code: 'DUPLICATE_CODE' }],
        'DUPLICATE_CODE'
      );
    }

    // 3. Parent account validation & currency consistency
    let parentWarning: RelationshipWarning | undefined;
    if (data.parent_id) {
      const parent = await this.repository.getAccountById(data.parent_id);
      if (!parent) {
        throw new BadRequestError(
          `Parent account with ID "${data.parent_id}" not found.`,
          [{ field: 'parent_id', message: 'Parent account does not exist', code: RELATIONSHIP_ERROR_CODES.PARENT_NOT_FOUND }],
          RELATIONSHIP_ERROR_CODES.PARENT_NOT_FOUND
        );
      }
      try {
        validateAccountParent(
          { code: data.code, currency_code: data.currency_code ?? 'INR', parent_id: data.parent_id },
          parent
        );
      } catch (err) {
        if (err instanceof DomainError) {
          throw new UnprocessableError(err.message, [err.context ?? {}], err.code);
        }
        throw err;
      }
    } else {
      const opt = handleOptionalRelationship(data.parent_id, 'parent_id', 'ACCOUNT_PARENT');
      parentWarning = opt.warning;
    }

    // 4. Persistence
    const account = await this.repository.createAccount(data);

    // 5. Persist import receipt in same transaction / atomic boundary if batch/idempotency provided
    let receipt: ImportReceipt | undefined;
    if (data.idempotency_key && data.batch_id && data.source_row !== undefined && data.source_row !== null) {
      receipt = await this.repository.createImportReceipt({
        batch_id: data.batch_id,
        source_row: data.source_row,
        entity: 'account',
        schema_version: 1,
        idempotency_key: data.idempotency_key,
        target_id: account.id,
        kind: 'created',
      });
    }

    const result = {
      account,
      created: true,
      ...(receipt && { receipt }),
      ...(parentWarning && { warning: parentWarning }),
    };

    await this.auditService.auditAccountCreated({
      actor: 'system',
      correlationId: randomUUID(),
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      currencyCode: account.currency_code,
      batchId: data.batch_id ?? undefined,
    }).catch(() => {});

    return result;
  }

  async updateAccount(id: string, updates: UpdateAccountRequest): Promise<Account> {
    const existing = await this.repository.getAccountById(id);
    if (!existing) {
      throw new NotFoundError('Account', id);
    }

    // Never accept protected/system-maintained fields as authoritative from browser
    // Only mutable fields: name, description, is_active, is_posting_account, parent_id
    if (updates.parent_id !== undefined) {
      if (updates.parent_id === id) {
        throw new UnprocessableError(
          `Account "${id}" cannot have itself as parent_id.`,
          [{ field: 'parent_id', message: 'Self-referential parent is not allowed', code: RELATIONSHIP_ERROR_CODES.CYCLE_DETECTED }],
          RELATIONSHIP_ERROR_CODES.CYCLE_DETECTED
        );
      }

      if (updates.parent_id !== null) {
        const parent = await this.repository.getAccountById(updates.parent_id);
        if (!parent) {
          throw new UnprocessableError(
            `Parent account with ID "${updates.parent_id}" not found.`,
            [{ field: 'parent_id', message: 'Parent account not found', code: RELATIONSHIP_ERROR_CODES.PARENT_NOT_FOUND }],
            RELATIONSHIP_ERROR_CODES.PARENT_NOT_FOUND
          );
        }

        try {
          validateAccountParent(
            { id, code: existing.code, currency_code: existing.currency_code, parent_id: updates.parent_id },
            parent
          );
        } catch (err) {
          if (err instanceof DomainError) {
            throw new UnprocessableError(err.message, [err.context ?? {}], err.code);
          }
          throw err;
        }

        // Circular hierarchy check across ancestry
        let curr: string | null | undefined = updates.parent_id;
        const visited = new Set<string>([id]);
        while (curr) {
          if (visited.has(curr)) {
            throw new UnprocessableError(
              `Circular parent hierarchy detected: account "${id}" is in the ancestor chain of "${updates.parent_id}".`,
              [{ field: 'parent_id', message: 'Circular parent hierarchy detected', code: RELATIONSHIP_ERROR_CODES.CYCLE_DETECTED }],
              RELATIONSHIP_ERROR_CODES.CYCLE_DETECTED
            );
          }
          visited.add(curr);
          const a = await this.repository.getAccountById(curr);
          curr = a?.parent_id;
        }
      }
    }

    const filteredUpdates: Partial<Account> = {
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.is_active !== undefined && { is_active: updates.is_active }),
      ...(updates.is_posting_account !== undefined && { is_posting_account: updates.is_posting_account }),
      ...(updates.parent_id !== undefined && { parent_id: updates.parent_id }),
    };

    const updated = await this.repository.updateAccount(id, filteredUpdates);

    await this.auditService.auditAccountUpdated({
      actor: 'system',
      correlationId: randomUUID(),
      accountId: id,
      updatedFields: filteredUpdates,
    }).catch(() => {});

    return updated;
  }

  // ── Accounting Periods ─────────────────────────────────────────────────────

  async listPeriods(query: PeriodListQuery): Promise<PeriodListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const { periods, total } = await this.repository.listPeriods({
      ...query,
      page,
      pageSize,
    });

    const totalPages = Math.ceil(total / pageSize) || 1;

    return {
      data: periods,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  async getPeriodById(id: string): Promise<AccountingPeriod> {
    const period = await this.repository.getPeriodById(id);
    if (!period) {
      throw new NotFoundError('Accounting period', id);
    }
    return period;
  }

  async updatePeriod(
    id: string,
    updates: UpdatePeriodRequest,
    user: { id: string; role?: string | undefined } = { id: 'system' }
  ): Promise<AccountingPeriod> {
    const period = await this.repository.getPeriodById(id);
    if (!period) {
      throw new NotFoundError('Accounting period', id);
    }

    if (updates.status && updates.status !== period.status) {
      assertValidPeriodStatus(updates.status);
      try {
        assertPeriodTransition(period.status, updates.status, period.period_label);
      } catch (err) {
        if (err instanceof DomainError) {
          throw new UnprocessableError(err.message, [err.context ?? {}], err.code);
        }
        throw err;
      }

      const now = new Date().toISOString();
      const isClosing = updates.status !== 'open';

      const updatedPeriod = await this.repository.updatePeriod(id, {
        status: updates.status,
        closed_at: isClosing ? now : null,
        closed_by_user_id: isClosing ? user.id : null,
      });

      await this.auditService.auditPeriodStatusChanged({
        actor: user.id,
        actorRole: user.role,
        correlationId: randomUUID(),
        periodId: id,
        periodLabel: period.period_label,
        oldStatus: period.status,
        newStatus: updates.status,
      }).catch(() => {});

      return updatedPeriod;
    }

    return period;
  }

  // ── Journal Entries ────────────────────────────────────────────────────────

  async listJournalEntries(query: JournalEntryListQuery): Promise<JournalEntryListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? query.limit ?? 20;

    const { entries, total } = await this.repository.listJournalEntries({
      ...query,
      page,
      pageSize,
    });

    const totalPages = Math.ceil(total / pageSize) || 1;

    return {
      data: entries,
      total,
      page,
      pageSize,
      limit: pageSize,
      totalPages,
    };
  }

  async getJournalEntryById(id: string): Promise<JournalEntry> {
    const entry = await this.repository.getJournalEntryById(id);
    if (!entry) {
      throw new NotFoundError('Journal entry', id);
    }
    assertJournalEntryReadConsistency(entry);
    return entry;
  }

  async createJournalEntry(
    data: CreateJournalEntryRequest,
    userId: string
  ): Promise<{ entry: JournalEntry; created: boolean; receipt?: ImportReceipt; warnings?: RelationshipWarning[] }> {
    const warnings: RelationshipWarning[] = [];

    // 1. Idempotency check
    if (data.idempotency_key) {
      const existing = await this.repository.getJournalEntryByIdempotencyKey(data.idempotency_key);
      if (existing) {
        if (
          existing.currency_code !== data.currency_code ||
          existing.period_id !== data.period_id
        ) {
          throw new IdempotencyConflictError(
            `Idempotency key "${data.idempotency_key}" was previously used with different journal entry parameters.`,
            [{ field: 'idempotency_key', message: 'Conflicting idempotency key parameters', code: 'IDEMPOTENCY_CONFLICT' }]
          );
        }
        const receipt = await this.repository.getImportReceiptByIdempotencyKey(data.idempotency_key);
        return { entry: existing, created: false, ...(receipt && { receipt }) };
      }
    }

    // 2. Validate period exists (required relationship)
    const period = await this.repository.getPeriodById(data.period_id);
    if (!period) {
      throw new BadRequestError(
        `Accounting period with ID "${data.period_id}" was not found.`,
        [{ field: 'period_id', code: RELATIONSHIP_ERROR_CODES.PERIOD_NOT_FOUND }],
        RELATIONSHIP_ERROR_CODES.PERIOD_NOT_FOUND
      );
    }

    // 3. Validate lines per-line constraints (BR-ERP4-01)
    if (!data.lines || data.lines.length < 2) {
      throw new BadRequestError(
        'A journal entry must contain at least 2 lines.',
        [{ field: 'lines', code: RELATIONSHIP_ERROR_CODES.MINIMUM_LINES_REQUIRED }],
        RELATIONSHIP_ERROR_CODES.MINIMUM_LINES_REQUIRED
      );
    }

    for (let idx = 0; idx < data.lines.length; idx++) {
      const line = data.lines[idx]!;
      assertJournalLineValid(
        {
          account_id: line.account_id,
          debit_amount: line.debit_amount ?? '0.0000',
          credit_amount: line.credit_amount ?? '0.0000',
        },
        idx
      );

      // Verify account exists and satisfies relationship rules
      const acct = await this.repository.getAccountById(line.account_id);
      if (!acct) {
        throw new BadRequestError(
          `Account "${line.account_id}" does not exist.`,
          [{ field: `lines[${idx}].account_id`, code: RELATIONSHIP_ERROR_CODES.ACCOUNT_NOT_FOUND }],
          RELATIONSHIP_ERROR_CODES.ACCOUNT_NOT_FOUND
        );
      }
      try {
        validateJournalLineAccount(
          {
            account_id: line.account_id,
            debit_amount: line.debit_amount,
            credit_amount: line.credit_amount,
          },
          acct,
          data.currency_code,
          idx
        );
      } catch (err) {
        if (err instanceof DomainError) {
          if (err.code === RELATIONSHIP_ERROR_CODES.CANNOT_POST_TO_HEADER_ACCOUNT) {
            throw new BadRequestError(
              `Account "${acct.code}" is a header account and cannot receive postings.`,
              [{ field: `lines[${idx}].account_id`, code: err.code }],
              err.code
            );
          }
          throw new UnprocessableError(
            err.message,
            [{ field: `lines[${idx}].account_id`, code: err.code }],
            err.code
          );
        }
        throw err;
      }

      // Cross-module department reference validation via ReferenceResolver
      if (line.department_ref) {
        if (this.referenceResolver) {
          try {
            await validateCrossModuleReference(
              this.referenceResolver,
              'department',
              line.department_ref,
              false,
              `lines[${idx}].department_ref`,
              RELATIONSHIP_ERROR_CODES.DEPARTMENT_NOT_FOUND
            );
          } catch (err) {
            if (err instanceof DomainError) {
              throw new UnprocessableError(err.message, [err.context ?? {}], err.code);
            }
            throw err;
          }
        }
      } else {
        const opt = handleOptionalRelationship(
          line.department_ref,
          `lines[${idx}].department_ref`,
          'JOURNAL_LINE_DEPARTMENT'
        );
        if (opt.warning) warnings.push(opt.warning);
      }
    }

    // Cross-module source reference validation via ReferenceResolver
    if (data.source_reference) {
      if (this.referenceResolver) {
        const match = data.source_reference.match(/^(invoice|sales_order|order):(.+)$/i);
        if (match && match[1] && match[2]) {
          try {
            await validateCrossModuleReference(
              this.referenceResolver,
              match[1].toLowerCase(),
              match[2],
              false,
              'source_reference',
              RELATIONSHIP_ERROR_CODES.SOURCE_ENTITY_NOT_FOUND
            );
          } catch (err) {
            if (err instanceof DomainError) {
              throw new UnprocessableError(err.message, [err.context ?? {}], err.code);
            }
            throw err;
          }
        }
      }
    } else {
      const opt = handleOptionalRelationship(
        data.source_reference,
        'source_reference',
        'JOURNAL_ENTRY_SOURCE'
      );
      if (opt.warning) warnings.push(opt.warning);
    }

    // 4. Validate double-entry balance invariant at 4 decimal places (BR-ERP4-01)
    try {
      assertDoubleEntryBalanced(
        data.lines.map((l) => ({
          account_id: l.account_id,
          debit_amount: l.debit_amount ?? '0.0000',
          credit_amount: l.credit_amount ?? '0.0000',
        })),
        data.currency_code
      );
    } catch (err) {
      if (err instanceof DomainError) {
        throw new BadRequestError(err.message, [err.context], RELATIONSHIP_ERROR_CODES.UNBALANCED_ENTRY);
      }
      throw err;
    }

    const entryNumber = `JV-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

    const entry = await this.repository.createJournalEntry({
      ...data,
      entry_number: entryNumber,
      created_by_user_id: userId,
    });

    assertJournalEntryReadConsistency(entry);

    // 5. Persist import receipt in same transaction / atomic boundary if import metadata provided
    let receipt: ImportReceipt | undefined;
    if (data.idempotency_key && data.batch_id && data.source_row !== undefined && data.source_row !== null) {
      receipt = await this.repository.createImportReceipt({
        batch_id: data.batch_id,
        source_row: data.source_row,
        entity: 'journal_entry',
        schema_version: 1,
        idempotency_key: data.idempotency_key,
        target_id: entry.id,
        kind: 'created',
      });
    }

    return {
      entry,
      created: true,
      ...(receipt && { receipt }),
      ...(warnings.length > 0 && { warnings }),
    };
  }

  async updateJournalEntry(
    id: string,
    updates: UpdateJournalEntryRequest,
    _userId: string
  ): Promise<JournalEntry> {
    const entry = await this.repository.getJournalEntryById(id);
    if (!entry) {
      throw new NotFoundError('Journal entry', id);
    }

    // Status machine: only draft entries can be edited.
    // Posted entries are immutable. Corrections use reversal entries.
    try {
      assertEntryIsEditable(entry.id, entry.status);
    } catch (err) {
      if (err instanceof DomainError) {
        throw new UnprocessableError(err.message, [err.context ?? {}], err.code);
      }
      throw err;
    }

    let periodId = entry.period_id;
    if (updates.period_id && updates.period_id !== entry.period_id) {
      const period = await this.repository.getPeriodById(updates.period_id);
      if (!period) {
        throw new BadRequestError(
          `Accounting period with ID "${updates.period_id}" was not found.`,
          [{ field: 'period_id', code: RELATIONSHIP_ERROR_CODES.PERIOD_NOT_FOUND }],
          RELATIONSHIP_ERROR_CODES.PERIOD_NOT_FOUND
        );
      }
      periodId = updates.period_id;
    }

    let lines = entry.lines;
    if (updates.lines) {
      if (updates.lines.length < 2) {
        throw new BadRequestError(
          'A journal entry must contain at least 2 lines.',
          [{ field: 'lines', code: RELATIONSHIP_ERROR_CODES.MINIMUM_LINES_REQUIRED }],
          RELATIONSHIP_ERROR_CODES.MINIMUM_LINES_REQUIRED
        );
      }

      for (let idx = 0; idx < updates.lines.length; idx++) {
        const line = updates.lines[idx]!;
        assertJournalLineValid(
          {
            account_id: line.account_id,
            debit_amount: line.debit_amount ?? '0.0000',
            credit_amount: line.credit_amount ?? '0.0000',
          },
          idx
        );

        const acct = await this.repository.getAccountById(line.account_id);
        if (!acct) {
          throw new BadRequestError(
            `Account "${line.account_id}" does not exist.`,
            [{ field: `lines[${idx}].account_id`, code: RELATIONSHIP_ERROR_CODES.ACCOUNT_NOT_FOUND }],
            RELATIONSHIP_ERROR_CODES.ACCOUNT_NOT_FOUND
          );
        }
        try {
          validateJournalLineAccount(
            {
              account_id: line.account_id,
              debit_amount: line.debit_amount,
              credit_amount: line.credit_amount,
            },
            acct,
            entry.currency_code,
            idx
          );
        } catch (err) {
          if (err instanceof DomainError) {
            if (err.code === RELATIONSHIP_ERROR_CODES.CANNOT_POST_TO_HEADER_ACCOUNT) {
              throw new BadRequestError(
                `Account "${acct.code}" is a header account and cannot receive postings.`,
                [{ field: `lines[${idx}].account_id`, code: err.code }],
                err.code
              );
            }
            throw new UnprocessableError(
              err.message,
              [{ field: `lines[${idx}].account_id`, code: err.code }],
              err.code
            );
          }
          throw err;
        }

        if (line.department_ref && this.referenceResolver) {
          try {
            await validateCrossModuleReference(
              this.referenceResolver,
              'department',
              line.department_ref,
              false,
              `lines[${idx}].department_ref`,
              RELATIONSHIP_ERROR_CODES.DEPARTMENT_NOT_FOUND
            );
          } catch (err) {
            if (err instanceof DomainError) {
              throw new UnprocessableError(err.message, [err.context ?? {}], err.code);
            }
            throw err;
          }
        }
      }

      try {
        assertDoubleEntryBalanced(
          updates.lines.map((l) => ({
            account_id: l.account_id,
            debit_amount: l.debit_amount ?? '0.0000',
            credit_amount: l.credit_amount ?? '0.0000',
          })),
          entry.currency_code
        );
      } catch (err) {
        if (err instanceof DomainError) {
          throw new UnprocessableError(err.message, [err.context], RELATIONSHIP_ERROR_CODES.UNBALANCED_ENTRY);
        }
        throw err;
      }

      lines = updates.lines.map((l) => ({
        id: randomUUID(),
        journal_entry_id: id,
        account_id: l.account_id,
        debit_amount: l.debit_amount ?? '0.0000',
        credit_amount: l.credit_amount ?? '0.0000',
        line_narration: l.line_narration ?? null,
        department_ref: l.department_ref ?? null,
        created_at: new Date().toISOString(),
      }));
    }

    const updated = await this.repository.updateJournalEntry(id, {
      ...(updates.posting_date && { posting_date: updates.posting_date }),
      ...(updates.description && { description: updates.description }),
      period_id: periodId,
      lines,
    });

    assertJournalEntryReadConsistency(updated);
    return updated;
  }

  async postJournalEntry(id: string, user: { id: string; role?: string | undefined }): Promise<JournalEntry> {
    const entry = await this.repository.getJournalEntryById(id);
    if (!entry) {
      throw new NotFoundError('Journal entry', id);
    }

    // Status machine: only draft entries can be posted
    try {
      assertJournalEntryTransition(entry.status, 'posted', entry.id);
    } catch (err) {
      if (err instanceof DomainError) {
        throw new UnprocessableError(err.message, [err.context ?? {}], err.code);
      }
      throw err;
    }

    // Domain invariant: Every posted journal entry balances exactly at currency precision (BR-ERP4-01)
    try {
      assertDoubleEntryBalanced(
        entry.lines.map((l) => ({
          account_id: l.account_id,
          debit_amount: l.debit_amount,
          credit_amount: l.credit_amount,
        })),
        entry.currency_code
      );
    } catch (err) {
      if (err instanceof DomainError) {
        throw new UnprocessableError(
          `Cannot post unbalanced journal entry: ${err.message}`,
          [err.context],
          RELATIONSHIP_ERROR_CODES.UNBALANCED_ENTRY
        );
      }
      throw err;
    }

    // Period posting guard (BR-ERP4-02): closed month rejects posting
    const period = await this.repository.getPeriodById(entry.period_id);
    if (!period) {
      throw new UnprocessableError(
        `Accounting period for entry "${id}" does not exist.`,
        [],
        RELATIONSHIP_ERROR_CODES.PERIOD_NOT_FOUND
      );
    }

    try {
      validateJournalEntryPeriod(period, user.role ?? 'staff');
    } catch (err) {
      if (err instanceof DomainError) {
        if (err.code === RELATIONSHIP_ERROR_CODES.PERIOD_LOCKED) {
          throw new UnprocessableError(
            `Cannot post entry: period "${period.period_label}" is locked.`,
            [err.context ?? {}],
            RELATIONSHIP_ERROR_CODES.PERIOD_LOCKED
          );
        }
        if (err.code === RELATIONSHIP_ERROR_CODES.PERIOD_SOFT_CLOSED) {
          throw new ForbiddenError(
            `Cannot post entry: period "${period.period_label}" is soft-closed and requires finance_admin role.`,
            RELATIONSHIP_ERROR_CODES.PERIOD_SOFT_CLOSED
          );
        }
      }
      throw err;
    }

    // Post and immutably lock entry
    const posted = await this.repository.updateJournalEntryStatus(id, {
      status: 'posted',
      posted_at: new Date().toISOString(),
      posted_by_user_id: user.id,
    });

    assertJournalEntryReadConsistency(posted);

    const totalAmount = (posted.lines ?? [])
      .reduce((sum, l) => sum + parseFloat(l.debit_amount || '0'), 0)
      .toFixed(2);

    await this.auditService.auditJournalPosted({
      actor: user.id,
      actorRole: user.role,
      correlationId: (user as any).correlationId || randomUUID(),
      journalEntryId: posted.id,
      entryNumber: posted.entry_number,
      periodId: posted.period_id,
      currencyCode: posted.currency_code,
      totalAmount,
    }).catch(() => {});

    return posted;
  }

  async reverseJournalEntry(
    id: string,
    data: ReverseJournalEntryRequest,
    user: { id: string; role?: string | undefined }
  ): Promise<{ original: JournalEntry; reversal: JournalEntry }> {
    const entry = await this.repository.getJournalEntryById(id);
    if (!entry) {
      throw new NotFoundError('Journal entry', id);
    }

    // Assert entry is reversible (must be posted, not draft/voided/already reversed)
    try {
      assertJournalEntryTransition(entry.status, 'reversed', entry.id);
    } catch (err) {
      if (err instanceof DomainError) {
        throw new UnprocessableError(
          `Cannot reverse journal entry: ${err.message}`,
          [err.context ?? {}],
          err.code
        );
      }
      throw err;
    }

    // Period posting guard on reversal date/period
    const period = await this.repository.getPeriodById(entry.period_id);
    if (!period) {
      throw new UnprocessableError(
        `Accounting period for entry "${id}" does not exist.`,
        [],
        RELATIONSHIP_ERROR_CODES.PERIOD_NOT_FOUND
      );
    }

    try {
      validateJournalEntryPeriod(period, user.role ?? 'staff');
    } catch (err) {
      if (err instanceof DomainError) {
        if (err.code === RELATIONSHIP_ERROR_CODES.PERIOD_LOCKED) {
          throw new UnprocessableError(
            `Cannot reverse entry into period "${period.period_label}": period is locked.`,
            [err.context ?? {}],
            RELATIONSHIP_ERROR_CODES.PERIOD_LOCKED
          );
        }
        if (err.code === RELATIONSHIP_ERROR_CODES.PERIOD_SOFT_CLOSED) {
          throw new ForbiddenError(
            `Cannot reverse entry into period "${period.period_label}": period is soft-closed and requires finance_admin role.`,
            RELATIONSHIP_ERROR_CODES.PERIOD_SOFT_CLOSED
          );
        }
      }
      throw err;
    }

    const reversalDate = data.reversal_date ?? new Date().toISOString().slice(0, 10);
    const reversalDescription =
      data.reversal_description ?? `Reversal of ${entry.entry_number}: ${entry.description}`;

    // Swap debit and credit lines
    const swappedLines = entry.lines.map((l) => ({
      account_id: l.account_id,
      debit_amount: l.credit_amount,
      credit_amount: l.debit_amount,
      line_narration: `Reversal leg: ${l.line_narration ?? ''}`.trim(),
      department_ref: l.department_ref ?? null,
    }));

    // Create the reversal entry directly in posted status
    const reversalNumber = `${entry.entry_number}-REV`;
    const reversalEntryDraft = await this.repository.createJournalEntry({
      period_id: entry.period_id,
      posting_date: reversalDate,
      description: reversalDescription,
      currency_code: entry.currency_code,
      source_reference: `REVERSAL:${entry.id}`,
      idempotency_key: `reversal-${entry.id}`,
      entry_number: reversalNumber,
      created_by_user_id: user.id,
      lines: swappedLines,
    });

    const postedReversal = await this.repository.updateJournalEntryStatus(reversalEntryDraft.id, {
      status: 'posted',
      posted_at: new Date().toISOString(),
      posted_by_user_id: user.id,
    });

    // Mark original entry as reversed and point to reversal entry
    const updatedOriginal = await this.repository.updateJournalEntryStatus(id, {
      status: 'reversed',
      reversed_by_entry_id: postedReversal.id,
    });

    assertJournalEntryReadConsistency(updatedOriginal);
    assertJournalEntryReadConsistency(postedReversal);

    await this.auditService.auditJournalReversed({
      actor: user.id,
      actorRole: user.role,
      correlationId: (user as any).correlationId || randomUUID(),
      originalEntryId: id,
      reversalEntryId: postedReversal.id,
      reason: (data as any).reason ?? data.reversal_description,
    }).catch(() => {});

    return { original: updatedOriginal, reversal: postedReversal };
  }

  async voidJournalEntry(id: string, _user: { id: string; role?: string | undefined }): Promise<JournalEntry> {
    const entry = await this.repository.getJournalEntryById(id);
    if (!entry) {
      throw new NotFoundError('Journal entry', id);
    }

    if (entry.status === 'voided') {
      return entry;
    }

    try {
      assertJournalEntryTransition(entry.status, 'voided', entry.id);
    } catch (err) {
      if (err instanceof DomainError) {
        throw new UnprocessableError(err.message, [err.context ?? {}], err.code);
      }
      throw err;
    }

    const voided = await this.repository.updateJournalEntryStatus(id, {
      status: 'voided',
    });

    assertJournalEntryReadConsistency(voided);
    return voided;
  }

  // ── Trial Balance ──────────────────────────────────────────────────────────

  async getTrialBalance(query: TrialBalanceQuery): Promise<TrialBalanceResponse> {
    const period = await this.repository.getPeriodByLabel(query.period);
    if (!period) {
      throw new NotFoundError('Accounting period', query.period);
    }

    // Retrieve all posted and reversed journal entries for this period (up to 100 each for V1)
    // In double-entry accounting, reversed entries remain in the ledger history and are offset
    // by their posted compensating reversal entries to maintain net balance consistency.
    const [postedRes, reversedRes] = await Promise.all([
      this.repository.listJournalEntries({
        period: query.period,
        status: 'posted',
        currency_code: query.currency_code,
        page: 1,
        pageSize: 100,
      }),
      this.repository.listJournalEntries({
        period: query.period,
        status: 'reversed',
        currency_code: query.currency_code,
        page: 1,
        pageSize: 100,
      }),
    ]);
    const entries = [...postedRes.entries, ...reversedRes.entries];

    // Extract lines into ledger movements
    const movements: Array<{
      account_id: string;
      currency_code: string;
      debit_amount: string;
      credit_amount: string;
    }> = [];

    for (const entry of entries) {
      for (const line of entry.lines) {
        movements.push({
          account_id: line.account_id,
          currency_code: entry.currency_code,
          debit_amount: line.debit_amount,
          credit_amount: line.credit_amount,
        });
      }
    }

    // Retrieve opening balances
    const { balances: openingBalancesList } = await this.repository.listOpeningBalances({
      currency_code: query.currency_code,
      page: 1,
      pageSize: 100,
    });

    const openingBalances = openingBalancesList.map((ob) => ({
      account_id: ob.account_id,
      currency_code: ob.currency_code,
      balance_amount: ob.balance_amount,
    }));

    // Compute trial balance rows using pure domain engine
    const rawRows = computeTrialBalance(movements, openingBalances);

    // Populate account metadata (code, name, type) for each row
    const enrichedRows: TrialBalanceRow[] = [];
    for (const row of rawRows) {
      const acct = await this.repository.getAccountById(row.account_id);
      enrichedRows.push({
        account_id: row.account_id,
        account_code: acct!.code,
        account_name: acct!.name,
        account_type: acct!.type,
        currency_code: row.currency_code,
        total_debit: row.total_debit,
        total_credit: row.total_credit,
        net_balance: row.net_balance,
        opening_balance: row.opening_balance,
        closing_balance: row.closing_balance,
      });
    }

    // Sort rows stably by account_code ASC
    enrichedRows.sort((a, b) => a.account_code.localeCompare(b.account_code));

    const totals = computeTrialBalanceTotals(enrichedRows);

    // Read model consistency assertion
    assertTrialBalanceReadConsistency(totals, enrichedRows);

    return {
      period: query.period,
      generated_at: new Date().toISOString(),
      rows: enrichedRows,
      totals,
    };
  }

  // ── Opening Balances ───────────────────────────────────────────────────────

  async listOpeningBalances(query: OpeningBalanceListQuery): Promise<OpeningBalanceListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const { balances, total } = await this.repository.listOpeningBalances({
      ...query,
      page,
      pageSize,
    });

    const totalPages = Math.ceil(total / pageSize) || 1;

    return {
      data: balances,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  async getOpeningBalanceById(id: string): Promise<OpeningBalance> {
    const balance = await this.repository.getOpeningBalanceById(id);
    if (!balance) {
      throw new NotFoundError('Opening balance', id);
    }
    return balance;
  }

  async createOpeningBalances(
    data: CreateOpeningBalancesRequest,
    userId: string
  ): Promise<CreateOpeningBalancesResponse> {
    const created: OpeningBalance[] = [];
    const skipped: Array<{ account_id: string; currency_code: string; reason: string }> = [];
    const receipts: ImportReceipt[] = [];

    // 1. Batch idempotency check
    if (data.idempotency_key) {
      const existingReceipt = await this.repository.getImportReceiptByIdempotencyKey(data.idempotency_key);
      if (existingReceipt) {
        const existingBalances: OpeningBalance[] = [];
        for (const item of data.balances) {
          const b = await this.repository.getOpeningBalance(item.account_id, item.currency_code);
          if (b) {
            existingBalances.push(b);
          }
        }
        return { created: existingBalances, skipped: [], receipts: [existingReceipt] };
      }
    }

    for (let idx = 0; idx < data.balances.length; idx++) {
      const item = data.balances[idx]!;

      // Item idempotency check
      if (item.idempotency_key) {
        const itemReceipt = await this.repository.getImportReceiptByIdempotencyKey(item.idempotency_key);
        if (itemReceipt) {
          const target = await this.repository.getOpeningBalanceById(itemReceipt.target_id);
          if (target) {
            if (target.account_id !== item.account_id || target.currency_code !== item.currency_code) {
              throw new IdempotencyConflictError(
                `Idempotency key "${item.idempotency_key}" was previously used with different balance parameters.`,
                [{ field: 'idempotency_key', message: 'Conflicting idempotency key parameters', code: 'IDEMPOTENCY_CONFLICT' }]
              );
            }
            created.push(target);
            receipts.push(itemReceipt);
            continue;
          }
        }
      }

      // Verify account exists and satisfies relationship rules
      const account = await this.repository.getAccountById(item.account_id);
      if (!account) {
        skipped.push({
          account_id: item.account_id,
          currency_code: item.currency_code,
          reason: `Account with ID "${item.account_id}" does not exist.`,
        });
        continue;
      }

      if (!account.is_active) {
        skipped.push({
          account_id: item.account_id,
          currency_code: item.currency_code,
          reason: `Account "${account.code}" is inactive and cannot receive opening balances.`,
        });
        continue;
      }

      if (!account.is_posting_account) {
        skipped.push({
          account_id: item.account_id,
          currency_code: item.currency_code,
          reason: `Account "${account.code}" is a header account and cannot receive opening balances.`,
        });
        continue;
      }

      if (account.currency_code !== item.currency_code) {
        skipped.push({
          account_id: item.account_id,
          currency_code: item.currency_code,
          reason: `Currency mismatch: account "${account.code}" uses "${account.currency_code}", but opening balance specifies "${item.currency_code}".`,
        });
        continue;
      }

      // Check if already loaded (FR-ERP4-04: one-time per account/currency)
      const existing = await this.repository.getOpeningBalance(item.account_id, item.currency_code);
      if (existing) {
        skipped.push({
          account_id: item.account_id,
          currency_code: item.currency_code,
          reason: `Opening balance already loaded for account "${account.code}" in currency "${item.currency_code}".`,
        });
        continue;
      }

      const balance = await this.repository.createOpeningBalance({
        account_id: item.account_id,
        currency_code: item.currency_code,
        balance_amount: item.balance_amount,
        as_of_date: item.as_of_date,
        source_reference: item.source_reference ?? null,
        loaded_by_user_id: userId,
      });

      created.push(balance);

      const effectiveBatchId = item.batch_id ?? data.batch_id;
      const effectiveSourceRow = item.source_row ?? idx;
      if (item.idempotency_key && effectiveBatchId) {
        const rec = await this.repository.createImportReceipt({
          batch_id: effectiveBatchId,
          source_row: effectiveSourceRow,
          entity: 'opening_balance',
          schema_version: 1,
          idempotency_key: item.idempotency_key,
          target_id: balance.id,
          kind: 'created',
        });
        receipts.push(rec);
      }
    }

    if (data.idempotency_key && created.length > 0) {
      const batchReceipt = await this.repository.createImportReceipt({
        batch_id: data.batch_id ?? randomUUID(),
        source_row: 0,
        entity: 'opening_balances_batch',
        schema_version: 1,
        idempotency_key: data.idempotency_key,
        target_id: created[0]!.id,
        kind: 'created',
      });
      receipts.push(batchReceipt);
    }

    const result = { created, skipped, ...(receipts.length > 0 && { receipts }) };

    await this.auditService.auditOpeningBalancesLoaded({
      actor: userId,
      correlationId: randomUUID(),
      batchId: data.batch_id ?? undefined,
      loadedCount: created.length,
      skippedCount: skipped.length,
    }).catch(() => {});

    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Migration Kit Target Ingestion (KIT-08 / Decision C4)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Commits domain mutation and durable receipt together in a single local transaction.
   * Handles idempotent replays and detects key reuse with mismatched payloads.
   */
  async importRow(req: ImportRowRequest): Promise<ImportRowResponse> {
    const requestHash = computeRequestHash(req.record);

    // 1. Check prior receipt
    const priorReceipt = await this.repository.getImportReceiptByIdempotencyKey(req.idempotency_key);
    if (priorReceipt) {
      if (priorReceipt.request_hash === requestHash) {
        // Idempotent replay: return prior result with HTTP 200 semantics
        return {
          target_id: priorReceipt.target_id,
          target_version: 1,
          outcome: (priorReceipt.outcome ?? 'loaded') as any,
          receipt: {
            id: priorReceipt.id,
            batch_id: priorReceipt.batch_id,
            source_row: priorReceipt.source_row,
            source_system: priorReceipt.source_system ?? req.source_system ?? null,
            source_id: priorReceipt.source_id ?? req.source_id ?? null,
            entity: priorReceipt.entity,
            schema_version: priorReceipt.schema_version ?? 1,
            idempotency_key: priorReceipt.idempotency_key,
            request_hash: priorReceipt.request_hash ?? requestHash,
            target_id: priorReceipt.target_id,
            kind: (priorReceipt.kind ?? 'created') as any,
            outcome: (priorReceipt.outcome ?? 'loaded') as any,
            response_payload: priorReceipt.response_payload ?? null,
            created_at: priorReceipt.created_at,
          },
          prior_result: true,
        };
      } else {
        // Key reuse with different payload: 409 Conflict
        throw new ConflictError(
          `Idempotency key '${req.idempotency_key}' was previously used with a different request payload`,
          [{ field: 'idempotency_key', idempotency_key: req.idempotency_key }],
          'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'
        );
      }
    }

    // 2. Execute atomic dual-write within local transaction
    return this.repository.executeTransactional(async (txRepo) => {
      let targetId: string;
      let responsePayload: unknown;

      if (req.entity === 'account') {
        const raw = req.record;
        const code = String(raw['code'] ?? '').trim();
        const name = String(raw['name'] ?? '').trim();
        const type = String(raw['type'] ?? '').trim();
        const currencyCode = String(raw['currency_code'] ?? 'INR').trim().toUpperCase();

        if (!code) {
          throw new BadRequestError("Account 'code' is required", [{ field: 'code' }]);
        }
        if (!name) {
          throw new BadRequestError("Account 'name' is required", [{ field: 'name' }]);
        }
        if (!['asset', 'liability', 'income', 'expense'].includes(type)) {
          throw new BadRequestError(
            `Invalid account type '${type}'. Must be asset, liability, income, or expense`,
            [{ field: 'type' }]
          );
        }

        // Code uniqueness invariant
        const existing = await txRepo.getAccountByCode(code);
        if (existing) {
          throw new ConflictError(
            `Account with code '${code}' already exists`,
            [{ field: 'code', code }],
            'ACCOUNT_CODE_EXISTS'
          );
        }

        const parentId = typeof raw['parent_id'] === 'string' && raw['parent_id'] ? raw['parent_id'] : null;
        if (parentId) {
          const parent = await txRepo.getAccountById(parentId);
          if (!parent) {
            throw new BadRequestError(`Parent account with ID '${parentId}' not found`, [{ field: 'parent_id' }]);
          }
          if (parent.currency_code !== currencyCode) {
            throw new UnprocessableError(
              `Parent account currency '${parent.currency_code}' does not match child currency '${currencyCode}'`,
              [{ field: 'parent_id' }],
              'CURRENCY_MISMATCH'
            );
          }
        }

        const isPostingAccount = raw['is_posting_account'] !== undefined ? Boolean(raw['is_posting_account']) : true;

        const createdAccount = await txRepo.createAccount({
          id: typeof raw['id'] === 'string' && raw['id'] ? raw['id'] : randomUUID(),
          code,
          name,
          type: type as any,
          currency_code: currencyCode,
          parent_id: parentId,
          description: typeof raw['description'] === 'string' ? raw['description'] : null,
          is_posting_account: isPostingAccount,
          idempotency_key: req.idempotency_key,
          batch_id: req.batch_id,
          source_row: req.source_row,
        });

        targetId = createdAccount.id;
        responsePayload = createdAccount;

      } else if (req.entity === 'journal_entry') {
        const raw = req.record;
        const periodId = typeof raw['period_id'] === 'string' ? raw['period_id'] : '';
        const postingDate = typeof raw['posting_date'] === 'string' ? raw['posting_date'] : '';
        const currencyCode = String(raw['currency_code'] ?? 'INR').trim().toUpperCase();
        const description = typeof raw['description'] === 'string' ? raw['description'] : '';
        const linesRaw = Array.isArray(raw['lines']) ? raw['lines'] : [];

        if (!periodId) {
          throw new BadRequestError("Journal entry 'period_id' is required", [{ field: 'period_id' }]);
        }
        if (!postingDate) {
          throw new BadRequestError("Journal entry 'posting_date' is required", [{ field: 'posting_date' }]);
        }
        if (linesRaw.length < 2) {
          throw new UnprocessableError(
            'Journal entry must contain at least 2 lines',
            [{ field: 'lines' }],
            'AT_LEAST_TWO_LINES_REQUIRED'
          );
        }

        // Verify period exists and is not locked (BR-ERP4-02)
        const period = await txRepo.getPeriodById(periodId);
        if (!period) {
          throw new BadRequestError(`Accounting period '${periodId}' not found`, [{ field: 'period_id' }]);
        }
        if (period.status === 'locked') {
          throw new UnprocessableError(
            `Accounting period '${period.period_label}' is locked. Posting into locked periods is prohibited.`,
            [{ field: 'period_id', period_status: 'locked' }],
            RELATIONSHIP_ERROR_CODES.PERIOD_LOCKED
          );
        }

        // Validate and normalize lines
        const lines = [];
        for (let i = 0; i < linesRaw.length; i++) {
          const l = linesRaw[i] as Record<string, unknown>;
          const accountId = typeof l['account_id'] === 'string' ? l['account_id'] : '';
          const debitRaw = l['debit_amount'] !== undefined ? l['debit_amount'] : l['debit'];
          const creditRaw = l['credit_amount'] !== undefined ? l['credit_amount'] : l['credit'];
          const debit = typeof debitRaw === 'string' || typeof debitRaw === 'number' ? String(debitRaw) : '0';
          const credit = typeof creditRaw === 'string' || typeof creditRaw === 'number' ? String(creditRaw) : '0';

          const account = await txRepo.getAccountById(accountId);
          if (!account) {
            throw new BadRequestError(
              `Account '${accountId}' at line ${i} not found`,
              [{ field: `lines[${i}].account_id` }],
              RELATIONSHIP_ERROR_CODES.ACCOUNT_NOT_FOUND
            );
          }
          if (!account.is_posting_account) {
            throw new UnprocessableError(
              `Cannot post to non-posting header account '${account.code}'`,
              [{ field: `lines[${i}].account_id`, code: account.code }],
              RELATIONSHIP_ERROR_CODES.CANNOT_POST_TO_HEADER_ACCOUNT
            );
          }
          if (account.currency_code !== currencyCode) {
            throw new UnprocessableError(
              `Account currency '${account.currency_code}' does not match journal currency '${currencyCode}'`,
              [{ field: `lines[${i}].account_id`, expected: currencyCode, got: account.currency_code }],
              'CURRENCY_MISMATCH'
            );
          }

          lines.push({
            id: typeof l['id'] === 'string' && l['id'] ? l['id'] : randomUUID(),
            account_id: accountId,
            debit_amount: debit,
            credit_amount: credit,
            description: typeof l['description'] === 'string' ? l['description'] : null,
          });
        }

        // Check double-entry exact balance invariant (BR-ERP4-01)
        try {
          assertDoubleEntryBalanced(lines, currencyCode);
        } catch (err) {
          if (err instanceof DomainError) {
            throw new UnprocessableError(
              `Cannot post unbalanced journal entry: ${err.message}`,
              [err.context],
              RELATIONSHIP_ERROR_CODES.UNBALANCED_ENTRY
            );
          }
          throw err;
        }

        // Header and lines commit in one database transaction
        const entryId = typeof raw['id'] === 'string' && raw['id'] ? raw['id'] : randomUUID();
        const entryNumber = typeof raw['entry_number'] === 'string' && raw['entry_number']
          ? raw['entry_number']
          : `JE-${Date.now()}-${randomUUID().slice(0, 4).toUpperCase()}`;

        const isPosting = raw['status'] === 'posted';
        const createdEntry = await txRepo.createJournalEntry({
          id: entryId,
          entry_number: entryNumber,
          posting_date: postingDate,
          description: description || 'Imported Journal Entry',
          currency_code: currencyCode,
          period_id: periodId,
          lines,
          created_by_user_id: typeof raw['created_by_user_id'] === 'string' ? raw['created_by_user_id'] : 'system',
          idempotency_key: req.idempotency_key,
          batch_id: req.batch_id,
          source_row: req.source_row,
        });

        if (isPosting) {
          await txRepo.updateJournalEntryStatus(entryId, {
            status: 'posted',
            posted_at: new Date().toISOString(),
            posted_by_user_id: 'system',
          });
        }

        targetId = createdEntry.id;
        responsePayload = createdEntry;

      } else if (req.entity === 'opening_balance') {
        const raw = req.record;
        const accountId = typeof raw['account_id'] === 'string' ? raw['account_id'] : '';
        const currencyCode = String(raw['currency_code'] ?? 'INR').trim().toUpperCase();
        const balanceAmount = typeof raw['balance_amount'] === 'string' || typeof raw['balance_amount'] === 'number'
          ? String(raw['balance_amount'])
          : '';
        const asOfDate = typeof raw['as_of_date'] === 'string' ? raw['as_of_date'] : '';

        if (!accountId) {
          throw new BadRequestError("Opening balance 'account_id' is required", [{ field: 'account_id' }]);
        }
        if (!balanceAmount) {
          throw new BadRequestError("Opening balance 'balance_amount' is required", [{ field: 'balance_amount' }]);
        }
        if (!asOfDate) {
          throw new BadRequestError("Opening balance 'as_of_date' is required", [{ field: 'as_of_date' }]);
        }

        const account = await txRepo.getAccountById(accountId);
        if (!account) {
          throw new BadRequestError(`Account with ID '${accountId}' not found`, [{ field: 'account_id' }]);
        }
        if (account.currency_code !== currencyCode) {
          throw new UnprocessableError(
            `Account currency '${account.currency_code}' does not match opening balance currency '${currencyCode}'`,
            [{ field: 'currency_code' }],
            'CURRENCY_MISMATCH'
          );
        }

        // Enforce one-time opening balance per account & currency (FR-ERP4-04)
        const existing = await txRepo.getOpeningBalance(accountId, currencyCode);
        if (existing) {
          throw new ConflictError(
            `Opening balance for account '${accountId}' and currency '${currencyCode}' already exists`,
            [{ field: 'account_id', account_id: accountId, currency_code: currencyCode }],
            'OPENING_BALANCE_ALREADY_EXISTS'
          );
        }

        const createdOb = await txRepo.createOpeningBalance({
          id: typeof raw['id'] === 'string' && raw['id'] ? raw['id'] : randomUUID(),
          account_id: accountId,
          currency_code: currencyCode,
          balance_amount: balanceAmount,
          as_of_date: asOfDate,
          source_reference: typeof raw['source_reference'] === 'string' ? raw['source_reference'] : null,
          loaded_by_user_id: typeof raw['loaded_by_user_id'] === 'string' ? raw['loaded_by_user_id'] : 'system',
        });

        targetId = createdOb.id;
        responsePayload = createdOb;

      } else {
        throw new BadRequestError(
          `Unsupported entity type for import: '${req.entity}'`,
          [{ field: 'entity', entity: req.entity }],
          'UNSUPPORTED_ENTITY'
        );
      }

      // 3. Insert durable import receipt in SAME transaction
      const receipt = await txRepo.createImportReceipt({
        batch_id: req.batch_id,
        source_row: req.source_row,
        source_system: req.source_system ?? null,
        source_id: req.source_id ?? null,
        entity: req.entity,
        schema_version: 1,
        idempotency_key: req.idempotency_key,
        request_hash: requestHash,
        target_id: targetId,
        kind: 'created',
        outcome: 'loaded',
        response_payload: responsePayload,
      });

      return {
        target_id: targetId,
        target_version: 1,
        outcome: 'loaded',
        receipt: {
          id: receipt.id,
          batch_id: receipt.batch_id,
          source_row: receipt.source_row,
          source_system: receipt.source_system ?? null,
          source_id: receipt.source_id ?? null,
          entity: receipt.entity,
          schema_version: receipt.schema_version ?? 1,
          idempotency_key: receipt.idempotency_key,
          request_hash: requestHash,
          target_id: targetId,
          kind: receipt.kind ?? 'created',
          outcome: 'loaded',
          response_payload: responsePayload,
          created_at: receipt.created_at,
        },
        prior_result: false,
      };
    });
  }
}
