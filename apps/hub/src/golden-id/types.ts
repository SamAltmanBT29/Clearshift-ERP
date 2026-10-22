import {
  GoldenIdRecord,
  SecondaryIdentifiers,
  GoldenIdStatus
} from "@clearshift/contracts";

export { GoldenIdRecord, SecondaryIdentifiers, GoldenIdStatus };

export interface IdentityAuditEvent {
  event_id: string;
  golden_id: string;
  event_type: "IDENTITY_CREATED" | "IDENTITY_ACCESSED" | "CONFLICT_DETECTED" | "MANUAL_MERGE";
  entity_type: string;
  source_system: string;
  source_id: string;
  details?: Record<string, any>;
  timestamp: string;
}
