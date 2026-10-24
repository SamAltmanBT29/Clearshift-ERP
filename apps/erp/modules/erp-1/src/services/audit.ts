/**
 * ERP-1 Products & Inventory — Audit Logging Service
 *
 * Implements:
 *   - Structured, append-only audit logging for ERP-1 operations (state transitions,
 *     creates, updates, merge reviews, migration loads, and security events).
 *   - Metadata sanitization ensuring no credentials, raw rows, tokens, or
 *     unmasked sensitive values are written to audit records.
 *
 * @module erp1/services/audit
 */

import type { FastifyRequest } from 'fastify';
import type {
  AuditEntryInput,
  AuditQueryFilter,
  AuditRecord,
  IAuditRepository,
} from '@cs/core';
import { AuditService, InMemoryAuditRepository } from '@cs/core';

export class Erp1AuditService {
  readonly auditService: AuditService;

  constructor(repository: IAuditRepository = new InMemoryAuditRepository()) {
    this.auditService = new AuditService(repository);
  }

  record(entry: AuditEntryInput): Promise<AuditRecord> {
    return this.auditService.log(entry);
  }

  log(entry: AuditEntryInput): Promise<AuditRecord> {
    return this.auditService.log(entry);
  }

  query(filter?: AuditQueryFilter): Promise<AuditRecord[]> {
    return this.auditService.query(filter);
  }
}

type RequestAuditEntry = Omit<
  AuditEntryInput,
  'actor' | 'actorRole' | 'correlationId'
>;

export function auditRequest(
  auditService: Erp1AuditService,
  request: FastifyRequest,
  entry: RequestAuditEntry,
): Promise<AuditRecord> {
  const correlationHeader = request.headers['x-correlation-id'];
  const requestHeader = request.headers['x-request-id'];
  const correlationId =
    typeof correlationHeader === 'string' && correlationHeader.trim()
      ? correlationHeader.trim()
      : typeof requestHeader === 'string' && requestHeader.trim()
        ? requestHeader.trim()
        : request.id;

  return auditService.record({
    ...entry,
    actor: request.user?.sub ?? 'anonymous',
    ...(request.user?.roles?.[0] ? { actorRole: request.user.roles[0] } : {}),
    correlationId,
  });
}
