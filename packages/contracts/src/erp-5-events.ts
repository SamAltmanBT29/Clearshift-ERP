/**
 * ERP-5 Human Resources — Domain Event Contracts
 *
 * Strongly-typed domain event schemas conforming to ClearShift Transactional
 * Event Envelope Schema (PLT-04 / PLT-09).
 *
 * Implements:
 *   - Employee lifecycle events (created, updated)
 *   - Department lifecycle events (created, updated)
 *   - Leave lifecycle events (requested, status_changed)
 *   - Payroll aggregate events (total_calculated)
 *
 * Traceability:
 *   - SDS ClearShift ERP v2.0 §5.0 (Human Resources)
 *   - SDS §3.2: event naming <noun>.<past_verb>
 *   - ADR-002: standard event envelope fields
 *   - Issue #190 ([ERP5-14])
 *
 * @module contracts/erp-5-events
 */

import { z } from 'zod';
import {
  HrUuid,
  HrDepartmentSchema,
  HrEmployeeViewSchema,
  HrLeaveSchema,
  HrPayrollTotalSchema,
  LeaveStatusEnum,
} from './erp-5.js';
import {
  createEventEnvelopeSchema,
  createEventEnvelope,
  type EventEnvelope,
} from './events.js';

export const PRODUCER = 'erp-5';

// ─────────────────────────────────────────────────────────────────────────────
// Event Type Constants
// ─────────────────────────────────────────────────────────────────────────────

export const ERP5_EVENT_TYPES = {
  // Produced by ERP-5
  EMPLOYEE_CREATED: 'erp.employee.created',
  EMPLOYEE_UPDATED: 'erp.employee.updated',
  DEPARTMENT_CREATED: 'erp.department.created',
  DEPARTMENT_UPDATED: 'erp.department.updated',
  LEAVE_REQUESTED: 'erp.leave.requested',
  LEAVE_STATUS_CHANGED: 'erp.leave.status_changed',
  PAYROLL_TOTAL_CALCULATED: 'erp.payroll_total.calculated',
} as const;

export type Erp5EventType = (typeof ERP5_EVENT_TYPES)[keyof typeof ERP5_EVENT_TYPES];

// ─────────────────────────────────────────────────────────────────────────────
// Event Payload Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payload for erp.employee.created / erp.employee.updated
 * Uses HrEmployeeViewSchema to ensure sensitive data (salary, birth_date)
 * is never leaked in event payloads.
 */
export const EmployeeLifecyclePayloadSchema = HrEmployeeViewSchema.extend({
  updatedAt: z.string().datetime().optional(),
  updatedByUserId: HrUuid.optional(),
});
export type EmployeeLifecyclePayload = z.infer<typeof EmployeeLifecyclePayloadSchema>;

/** Payload for erp.department.created / erp.department.updated */
export const DepartmentLifecyclePayloadSchema = HrDepartmentSchema.extend({
  updatedAt: z.string().datetime().optional(),
  updatedByUserId: HrUuid.optional(),
});
export type DepartmentLifecyclePayload = z.infer<typeof DepartmentLifecyclePayloadSchema>;

/** Payload for erp.leave.requested */
export const LeaveRequestedPayloadSchema = HrLeaveSchema.extend({
  requestedAt: z.string().datetime(),
  requestedByUserId: HrUuid,
});
export type LeaveRequestedPayload = z.infer<typeof LeaveRequestedPayloadSchema>;

/** Payload for erp.leave.status_changed */
export const LeaveStatusChangedPayloadSchema = z.object({
  id: HrUuid,
  previousStatus: LeaveStatusEnum,
  newStatus: LeaveStatusEnum,
  changedAt: z.string().datetime(),
  changedByUserId: HrUuid,
  reason: z.string().max(500).nullable().optional(),
});
export type LeaveStatusChangedPayload = z.infer<typeof LeaveStatusChangedPayloadSchema>;

/** Payload for erp.payroll_total.calculated */
export const PayrollTotalCalculatedPayloadSchema = HrPayrollTotalSchema.extend({
  calculatedAt: z.string().datetime(),
  calculatedByUserId: HrUuid,
});
export type PayrollTotalCalculatedPayload = z.infer<typeof PayrollTotalCalculatedPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Envelope Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const EmployeeCreatedEventSchema = createEventEnvelopeSchema(EmployeeLifecyclePayloadSchema);
export const EmployeeUpdatedEventSchema = createEventEnvelopeSchema(EmployeeLifecyclePayloadSchema);
export const DepartmentCreatedEventSchema = createEventEnvelopeSchema(DepartmentLifecyclePayloadSchema);
export const DepartmentUpdatedEventSchema = createEventEnvelopeSchema(DepartmentLifecyclePayloadSchema);
export const LeaveRequestedEventSchema = createEventEnvelopeSchema(LeaveRequestedPayloadSchema);
export const LeaveStatusChangedEventSchema = createEventEnvelopeSchema(LeaveStatusChangedPayloadSchema);
export const PayrollTotalCalculatedEventSchema = createEventEnvelopeSchema(PayrollTotalCalculatedPayloadSchema);

// ─────────────────────────────────────────────────────────────────────────────
// Event Helper Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createErp5Event<T>(params: {
  event_id?: string;
  event_type: Erp5EventType;
  schema_version?: string;
  occurred_at?: string;
  correlation_id: string;
  entity_type: 'employee' | 'department' | 'leave' | 'payroll_total';
  entity_id: string;
  batch_id?: string;
  payload: T;
  metadata?: Record<string, unknown>;
}): EventEnvelope {
  const envelopeParams: Parameters<typeof createEventEnvelope>[0] = {
    event_id: params.event_id ?? crypto.randomUUID(),
    event_type: params.event_type,
    correlation_id: params.correlation_id,
    producer: 'erp-5',
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
  if (params.batch_id !== undefined) {
    envelopeParams.batch_id = params.batch_id;
  }
  if (params.metadata !== undefined) {
    envelopeParams.metadata = params.metadata;
  }
  return createEventEnvelope(envelopeParams);
}
