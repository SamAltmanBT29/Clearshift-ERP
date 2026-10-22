import { randomUUID, randomBytes } from "node:crypto";

const ENTITY_PREFIX_MAP: Record<string, string> = {
  customer: "CUST",
  vendor: "VEND",
  contact: "CONT",
  employee: "EMP",
  account: "ACCT",
  deal: "DEAL"
};

/**
 * Generates the authoritative Primary Key for Golden ID.
 * NON-NEGOTIABLE INVARIANT: Primary and foreign keys are ALWAYS UUIDs.
 */
export function generateGoldenUuid(): string {
  return randomUUID();
}

/**
 * Generates human-friendly display-only GID identifier.
 * NON-NEGOTIABLE INVARIANT: Display GIDs are display-only and NEVER
 * used as primary or foreign keys in database schemas.
 */
export function generateDisplayGid(entityType: string): string {
  const normalizedType = entityType.toLowerCase();
  const prefix = ENTITY_PREFIX_MAP[normalizedType] || normalizedType.substring(0, 4).toUpperCase();
  const hex = randomBytes(4).toString("hex").toUpperCase();
  return `GID-${prefix}-${hex}`;
}
