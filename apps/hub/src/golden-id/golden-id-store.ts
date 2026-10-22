import { randomUUID } from "node:crypto";
import { GoldenIdRecord, SecondaryIdentifiers, IdentityAuditEvent } from "./types.js";
import { generateGoldenUuid, generateDisplayGid } from "./id-generator.js";

export class GoldenIdStore {
  private static instance: GoldenIdStore;

  // Primary source key map: "entity_type:source_system:source_id" -> GoldenIdRecord
  private readonly sourceKeyMap: Map<string, GoldenIdRecord> = new Map();

  // Primary UUID map: id -> GoldenIdRecord
  private readonly idMap: Map<string, GoldenIdRecord> = new Map();

  // Secondary identifier index: "entity_type:type:value" -> id
  private readonly secondaryIndex: Map<string, string> = new Map();

  // In-flight upsert promises to prevent race conditions during concurrent calls
  private readonly inFlightUpserts: Map<string, Promise<{ record: GoldenIdRecord; is_new: boolean }>> = new Map();

  // Audit event log
  private readonly auditEvents: IdentityAuditEvent[] = [];

  public static getInstance(): GoldenIdStore {
    if (!GoldenIdStore.instance) {
      GoldenIdStore.instance = new GoldenIdStore();
    }
    return GoldenIdStore.instance;
  }

  private makeSourceKey(entityType: string, sourceSystem: string, sourceId: string): string {
    return `${entityType.toLowerCase()}:${sourceSystem.toLowerCase()}:${String(sourceId)}`;
  }

  private normalizeIdentifier(val?: string): string | undefined {
    if (!val) return undefined;
    return val.trim().toLowerCase();
  }

  /**
   * Looks up a Golden ID by source system and source identifier.
   * Explicitly returns null when not found.
   */
  public async lookup(
    entityType: string,
    sourceSystem: string,
    sourceId: string
  ): Promise<GoldenIdRecord | null> {
    const key = this.makeSourceKey(entityType, sourceSystem, sourceId);
    const record = this.sourceKeyMap.get(key);

    if (record) {
      this.auditEvents.push({
        event_id: randomUUID(),
        golden_id: record.id,
        event_type: "IDENTITY_ACCESSED",
        entity_type: entityType,
        source_system: sourceSystem,
        source_id: String(sourceId),
        timestamp: new Date().toISOString()
      });
      return { ...record };
    }

    return null;
  }

  /**
   * Idempotently creates or retrieves a Golden ID mapping.
   * Concurrency Safe: Uses in-flight lock to guarantee exactly one row is created.
   * Conflict Detection: Secondary identifier collisions open a review candidate without auto-merging.
   */
  public async upsert(
    entityType: string,
    sourceSystem: string,
    sourceId: string,
    identifiers?: SecondaryIdentifiers
  ): Promise<{ record: GoldenIdRecord; is_new: boolean }> {
    const key = this.makeSourceKey(entityType, sourceSystem, sourceId);

    // 1. Check existing record
    const existing = this.sourceKeyMap.get(key);
    if (existing) {
      return { record: { ...existing }, is_new: false };
    }

    // 2. Handle concurrent in-flight requests for the exact same source key
    const inFlight = this.inFlightUpserts.get(key);
    if (inFlight) {
      return inFlight;
    }

    const upsertPromise = (async () => {
      try {
        // Double check after lock acquisition
        const doubleCheck = this.sourceKeyMap.get(key);
        if (doubleCheck) {
          return { record: { ...doubleCheck }, is_new: false };
        }

        const now = new Date().toISOString();
        const primaryId = generateGoldenUuid();
        const displayGid = generateDisplayGid(entityType);

        // Conflict check across secondary identifiers (tax_id, email, phone)
        const secondary = identifiers || {};
        const conflictingIds: string[] = [];
        let conflictReason: string | undefined = undefined;

        const checkFields: (keyof SecondaryIdentifiers)[] = ["tax_id", "email", "phone"];
        for (const field of checkFields) {
          const val = this.normalizeIdentifier(secondary[field]);
          if (val) {
            const secKey = `${entityType.toLowerCase()}:${field}:${val}`;
            const existingIdWithSameSecondary = this.secondaryIndex.get(secKey);
            if (existingIdWithSameSecondary && existingIdWithSameSecondary !== primaryId) {
              conflictingIds.push(existingIdWithSameSecondary);
              conflictReason = `Conflicting ${field} ('${val}') matched existing Golden ID ${existingIdWithSameSecondary}`;
              break;
            }
          }
        }

        // NON-NEGOTIABLE CONSTRAINT: No fuzzy auto-merge.
        // Conflicting tax/email/phone evidence opens a review candidate.
        const status = conflictingIds.length > 0 ? "needs_review" : "active";

        const newRecord: GoldenIdRecord = {
          id: primaryId,
          display_gid: displayGid,
          entity_type: entityType,
          source_system: sourceSystem,
          source_id: String(sourceId), // Preserved as string without lossy coercion
          identifiers: secondary,
          status,
          ...(conflictReason ? { review_reason: conflictReason } : {}),
          conflicting_ids: conflictingIds,
          created_at: now,
          updated_at: now
        };

        // Commit to maps
        this.sourceKeyMap.set(key, newRecord);
        this.idMap.set(primaryId, newRecord);

        // Index secondary identifiers if active
        if (status === "active") {
          for (const field of checkFields) {
            const val = this.normalizeIdentifier(secondary[field]);
            if (val) {
              const secKey = `${entityType.toLowerCase()}:${field}:${val}`;
              this.secondaryIndex.set(secKey, primaryId);
            }
          }
        }

        // Audit creation
        this.auditEvents.push({
          event_id: randomUUID(),
          golden_id: primaryId,
          event_type: status === "needs_review" ? "CONFLICT_DETECTED" : "IDENTITY_CREATED",
          entity_type: entityType,
          source_system: sourceSystem,
          source_id: String(sourceId),
          details: { status, conflictReason, conflictingIds },
          timestamp: now
        });

        return { record: { ...newRecord }, is_new: true };
      } finally {
        this.inFlightUpserts.delete(key);
      }
    })();

    this.inFlightUpserts.set(key, upsertPromise);
    return upsertPromise;
  }

  public async getById(id: string): Promise<GoldenIdRecord | null> {
    const record = this.idMap.get(id);
    return record ? { ...record } : null;
  }

  public async getReviewCandidates(): Promise<GoldenIdRecord[]> {
    const candidates: GoldenIdRecord[] = [];
    for (const record of this.idMap.values()) {
      if (record.status === "needs_review") {
        candidates.push({ ...record });
      }
    }
    return candidates;
  }

  public getAuditEvents(): readonly IdentityAuditEvent[] {
    return [...this.auditEvents];
  }

  public reset(): void {
    this.sourceKeyMap.clear();
    this.idMap.clear();
    this.secondaryIndex.clear();
    this.inFlightUpserts.clear();
    this.auditEvents.length = 0;
  }
}

export const goldenIdStore = GoldenIdStore.getInstance();
