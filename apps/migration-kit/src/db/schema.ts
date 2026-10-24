import { pgTable, pgSchema, uuid, text, timestamp, jsonb, integer, bigint } from "drizzle-orm/pg-core";

export const platformSchema = pgSchema("platform");

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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Migration Kit Batch Registry Schema (KIT-01)
 * Authoritative record of each batch execution across the 7-step migration pipeline.
 */
export const kitBatches = pgTable("kit_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchNumber: text("batch_number").notNull().unique(),
  module: text("module").notNull(),
  sourceSystem: text("source_system"),
  fileName: text("file_name"),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  checksum: text("checksum").notNull(),
  status: text("status").notNull().default("created"),
  previousStatus: text("previous_status"),
  checkpoint: text("checkpoint").notNull().default("created"),
  attempt: integer("attempt").notNull().default(1),
  maxAttempts: integer("max_attempts").notNull().default(3),
  totalRows: integer("total_rows").notNull().default(0),
  loadedRows: integer("loaded_rows").notNull().default(0),
  rejectedRows: integer("rejected_rows").notNull().default(0),
  mergedRows: integer("merged_rows").notNull().default(0),
  skippedRows: integer("skipped_rows").notNull().default(0),
  unaccountedRows: integer("unaccounted_rows").notNull().default(0),
  ruleVersion: text("rule_version").notNull().default("1.0.0"),
  codeVersion: text("code_version").notNull().default("1.0.0"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  correlationId: text("correlation_id").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdBy: text("created_by").notNull().default("system"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Migration Kit Immutable Step Ledger Schema (KIT-01)
 * Append-only ledger recording every state transition, telemetry counts, and duration.
 * UPDATE and DELETE statements are strictly blocked by database trigger.
 */
export const kitBatchSteps = pgTable("kit_batch_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => kitBatches.id, { onDelete: "restrict" }),
  stepNumber: integer("step_number").notNull(),
  stepName: text("step_name").notNull(),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  attempt: integer("attempt").notNull().default(1),
  checkpoint: text("checkpoint").notNull(),
  recordsIn: integer("records_in").notNull().default(0),
  recordsOut: integer("records_out").notNull().default(0),
  recordsRejected: integer("records_rejected").notNull().default(0),
  recordsMerged: integer("records_merged").notNull().default(0),
  recordsSkipped: integer("records_skipped").notNull().default(0),
  ruleVersion: text("rule_version").notNull().default("1.0.0"),
  codeVersion: text("code_version").notNull().default("1.0.0"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  correlationId: text("correlation_id").notNull(),
  actor: text("actor").notNull().default("system"),
  durationMs: integer("duration_ms"),
  metadata: jsonb("metadata").notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Migration Kit Raw Rows Schema (KIT-02)
 * Immutable landing table storing extracted source rows with original payload and checksum.
 * UPDATE and DELETE statements are strictly blocked by database trigger.
 */
export const rawRows = pgTable("raw_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => kitBatches.id, { onDelete: "cascade" }),
  sourceRow: integer("source_row").notNull(),
  headers: text("headers").array().notNull(),
  cells: text("cells").array().notNull(),
  payload: jsonb("payload").notNull(),
  rowHash: text("row_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Migration Kit Column Profile Reports Schema (KIT-03)
 * Stores computed per-column data health metrics (empties, invalid formats, top values).
 */
export const kitProfileReports = pgTable("kit_profile_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => kitBatches.id, { onDelete: "cascade" }),
  columnName: text("column_name").notNull(),
  emptyCount: integer("empty_count").notNull().default(0),
  invalidCount: integer("invalid_count").notNull().default(0),
  distinctCount: integer("distinct_count").notNull().default(0),
  inferredType: text("inferred_type").notNull().default("string"),
  topValuesJson: jsonb("top_values_json").notNull().default([]),
  minValue: text("min_value"),
  maxValue: text("max_value"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Migration Kit Cleaning Audit Log Schema (KIT-04)
 * Stores every field-level mutation with rule ID, version, and masked values.
 */
export const kitCleanLog = pgTable("kit_clean_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => kitBatches.id, { onDelete: "cascade" }),
  sourceRow: integer("source_row").notNull(),
  fieldName: text("field_name").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  ruleId: text("rule_id").notNull(),
  ruleVersion: text("rule_version").notNull().default("1.0.0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Migration Kit Rejects Schema (KIT-04 / SDS §4.10)
 * Stores row-level rejection decisions with stable reason codes, human-readable explanations, and raw payload.
 */
export const kitRejects = pgTable("kit_rejects", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => kitBatches.id, { onDelete: "cascade" }),
  sourceRow: integer("source_row").notNull(),
  entity: text("entity").notNull(),
  reasonCode: text("reason_code").notNull(),
  reasonText: text("reason_text").notNull(),
  rawJson: jsonb("raw_json").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Migration Kit Staging Table (KIT-04 / SDS §3.3 stg_<module>)
 * Stores intermediate staged records with cleaning outcome, cleaned payload, and reject reason.
 */
export const stgRows = pgTable("stg_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => kitBatches.id, { onDelete: "cascade" }),
  sourceRow: integer("source_row").notNull(),
  status: text("status").notNull().default("cleaned"),
  payload: jsonb("payload").notNull().default({}),
  rejectReason: text("reject_reason"),
  goldenId: text("golden_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Migration Kit Mapping Templates Schema (KIT-05 / SDS §4.10)
 * Stores named, versioned, module-scoped source-to-target field mapping templates.
 */
export const kitMappings = pgTable("kit_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  module: text("module").notNull(),
  name: text("name").notNull(),
  version: text("version").notNull().default("1.0.0"),
  targetEntity: text("target_entity").notNull().default("contacts"),
  mappingJson: jsonb("mapping_json").notNull().default([]),
  valueConversionsJson: jsonb("value_conversions_json").notNull().default([]),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Migration Kit Clean Module Staging Table (KIT-05 / SDS §4.5 clean_<module>)
 * Stores mapped records containing ONLY target fields while preserving durable batch and source row linkage.
 */
export const cleanCrm = pgTable("clean_crm", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id")
    .notNull()
    .references(() => kitBatches.id, { onDelete: "cascade" }),
  sourceRow: integer("source_row").notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
