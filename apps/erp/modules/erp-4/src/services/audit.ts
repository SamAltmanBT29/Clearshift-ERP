/**
 * ERP-4 Finance & Accounting — Audit Service Adapter (PLT-10 / ERP4-09)
 *
 * Emits append-only audit records for financial state changes, privileged mutations,
 * bulk loads, and data exports.
 *
 * Guarantees:
 *   - Captures actor, action, timestamp, entity/batch correlation, and outcome
 *   - Metadata is deeply redacted to ensure zero exposure of passwords, JWTs, full bank details, or raw rows
 *   - Safe error messages and sanitized reasons
 *
 * @module erp4/services/audit
 */

import { randomUUID } from 'node:crypto';
import {
  AuditService,
  InMemoryAuditRepository,
  type IAuditRepository,
  type AuditRecord,
  type AuditQueryFilter,
  redactSensitiveData,
} from '@cs/core';

export interface AuditFinanceParams {
  actor: string;
  actorRole?: string | undefined;
  correlationId?: string | undefined;
  batchId?: string | undefined;
}

export class Erp4AuditService {
  private readonly auditService: AuditService;

  constructor(repository: IAuditRepository = new InMemoryAuditRepository()) {
    this.auditService = new AuditService(repository);
  }

  get underlying(): AuditService {
    return this.auditService;
  }

  /**
   * Audit posting of a journal entry (locks entry permanently).
   */
  async auditJournalPosted(params: AuditFinanceParams & {
    journalEntryId: string;
    entryNumber: string;
    periodId: string;
    currencyCode: string;
    totalAmount: string;
  }): Promise<AuditRecord> {
    return this.auditService.log({
      actor: params.actor,
      actorRole: params.actorRole,
      action: 'journal.posted',
      targetEntity: 'journal_entry',
      targetId: params.journalEntryId,
      correlationId: params.correlationId ?? randomUUID(),
      batchId: params.batchId,
      result: 'success',
      metadata: redactSensitiveData({
        entryNumber: params.entryNumber,
        periodId: params.periodId,
        currencyCode: params.currencyCode,
        totalAmount: params.totalAmount,
      }),
    });
  }

  /**
   * Audit reversal of a posted journal entry.
   */
  async auditJournalReversed(params: AuditFinanceParams & {
    originalEntryId: string;
    reversalEntryId: string;
    reason?: string | undefined;
  }): Promise<AuditRecord> {
    return this.auditService.log({
      actor: params.actor,
      actorRole: params.actorRole,
      action: 'journal.reversed',
      targetEntity: 'journal_entry',
      targetId: params.originalEntryId,
      correlationId: params.correlationId ?? randomUUID(),
      result: 'success',
      reason: params.reason,
      metadata: redactSensitiveData({
        originalEntryId: params.originalEntryId,
        reversalEntryId: params.reversalEntryId,
      }),
    });
  }

  /**
   * Audit bulk load of opening balances.
   */
  async auditOpeningBalancesLoaded(params: AuditFinanceParams & {
    loadedCount: number;
    skippedCount: number;
    currencyCode?: string | undefined;
  }): Promise<AuditRecord> {
    return this.auditService.log({
      actor: params.actor,
      actorRole: params.actorRole,
      action: 'load.requested',
      targetEntity: 'opening_balances',
      correlationId: params.correlationId ?? randomUUID(),
      batchId: params.batchId,
      result: 'success',
      metadata: redactSensitiveData({
        loadedCount: params.loadedCount,
        skippedCount: params.skippedCount,
        currencyCode: params.currencyCode,
      }),
    });
  }

  /**
   * Audit creation of a new Chart of Accounts record.
   */
  async auditAccountCreated(params: AuditFinanceParams & {
    accountId: string;
    accountCode: string;
    accountName: string;
    accountType: string;
    currencyCode: string;
  }): Promise<AuditRecord> {
    return this.auditService.log({
      actor: params.actor,
      actorRole: params.actorRole,
      action: 'account.created',
      targetEntity: 'account',
      targetId: params.accountId,
      correlationId: params.correlationId ?? randomUUID(),
      batchId: params.batchId,
      result: 'success',
      metadata: redactSensitiveData({
        code: params.accountCode,
        name: params.accountName,
        type: params.accountType,
        currencyCode: params.currencyCode,
      }),
    });
  }

  /**
   * Audit update to an existing Account.
   */
  async auditAccountUpdated(params: AuditFinanceParams & {
    accountId: string;
    updatedFields: Record<string, unknown>;
  }): Promise<AuditRecord> {
    return this.auditService.log({
      actor: params.actor,
      actorRole: params.actorRole,
      action: 'account.updated',
      targetEntity: 'account',
      targetId: params.accountId,
      correlationId: params.correlationId ?? randomUUID(),
      result: 'success',
      metadata: redactSensitiveData({
        updatedFields: Object.keys(params.updatedFields),
      }),
    });
  }

  /**
   * Audit fiscal period status change (e.g. open -> soft_closed -> locked).
   */
  async auditPeriodStatusChanged(params: AuditFinanceParams & {
    periodId: string;
    periodLabel: string;
    oldStatus: string;
    newStatus: string;
  }): Promise<AuditRecord> {
    return this.auditService.log({
      actor: params.actor,
      actorRole: params.actorRole,
      action: 'period.status_changed',
      targetEntity: 'accounting_period',
      targetId: params.periodId,
      correlationId: params.correlationId ?? randomUUID(),
      result: 'success',
      metadata: redactSensitiveData({
        periodLabel: params.periodLabel,
        oldStatus: params.oldStatus,
        newStatus: params.newStatus,
      }),
    });
  }

  /**
   * Audit generation of financial export (CSV / reports).
   */
  async auditExportGenerated(params: AuditFinanceParams & {
    exportType: 'csv' | 'json';
    entityType: string;
    recordCount: number;
  }): Promise<AuditRecord> {
    return this.auditService.logExport({
      actor: params.actor,
      correlationId: params.correlationId ?? randomUUID(),
      exportType: params.exportType,
      entityType: params.entityType,
      recordCount: params.recordCount,
    });
  }

  /**
   * Query recorded audit records.
   */
  async query(filter?: AuditQueryFilter): Promise<AuditRecord[]> {
    return this.auditService.query(filter);
  }
}
