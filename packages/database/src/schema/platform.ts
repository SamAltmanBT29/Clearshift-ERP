import { pgSchema, uuid, text, timestamp, jsonb, primaryKey, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";

export const platformSchema = pgSchema("platform");

export const hubUsers = platformSchema.table("hub_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  roles: text("roles").array().notNull(), // text array of roles
  employeeRef: uuid("employee_ref"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubCredentials = platformSchema.table("hub_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => hubUsers.id, { onDelete: "cascade" }),
  argon2Hash: text("argon2_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubRefreshTokens = platformSchema.table("hub_refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => hubUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  rotatedFrom: text("rotated_from"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubSigningKeys = platformSchema.table("hub_signing_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  kid: text("kid").notNull().unique(),
  publicJwk: jsonb("public_jwk").notNull(),
  privateEnc: text("private_enc").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const hubIdMap = platformSchema.table("hub_id_map", {
  id: uuid("id").primaryKey().defaultRandom(),
  goldenId: text("golden_id").notNull(),
  sourceSystem: text("source_system").notNull(),
  sourceId: text("source_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const outbox = platformSchema.table("outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  schemaVersion: text("schema_version").notNull().default("1.0.0"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  producer: text("producer").notNull(),
  correlationId: text("correlation_id").notNull(),
  batchId: text("batch_id"),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  payload: jsonb("payload").notNull(),
  metadata: jsonb("metadata"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
  retryCount: integer("retry_count").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const consumedEvents = platformSchema.table("consumed_events", {
  consumer: text("consumer").notNull(),
  eventId: uuid("event_id").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  primaryKey({ columns: [table.consumer, table.eventId] })
]);

export const audit = platformSchema.table("audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: uuid("entity_id"),
  diffRedacted: jsonb("diff_redacted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const kitRowOutcomes = platformSchema.table("kit_row_outcomes", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: text("batch_id").notNull(),
  sourceRow: integer("source_row").notNull(),
  outcome: text("outcome").notNull(),
  targetId: text("target_id"),
  reasonCode: text("reason_code"),
  reasonText: text("reason_text"),
  operator: text("operator"),
  operatorRole: text("operator_role"),
  policyCode: text("policy_code"),
  idempotencyKey: text("idempotency_key"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("kit_row_outcomes_batch_source_row_idx").on(table.batchId, table.sourceRow)
]);

export const kitReconciliations = platformSchema.table("kit_reconciliations", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: text("batch_id").notNull().unique(),
  sourceCount: integer("source_count").notNull(),
  loadedCount: integer("loaded_count").notNull(),
  rejectedCount: integer("rejected_count").notNull(),
  mergedCount: integer("merged_count").notNull(),
  skippedCount: integer("skipped_count").notNull(),
  unaccountedCount: integer("unaccounted_count").notNull(),
  result: text("result").notNull(),
  signoffDisabled: boolean("signoff_disabled").notNull().default(false),
  formulaHolds: boolean("formula_holds").notNull().default(false),
  failureReasons: jsonb("failure_reasons"),
  reconciledBy: text("reconciled_by"),
  reconciledAt: timestamp("reconciled_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
