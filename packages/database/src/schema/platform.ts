import { pgSchema, uuid, text, timestamp, jsonb, primaryKey } from "drizzle-orm/pg-core";

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
  payload: jsonb("payload").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const consumedEvents = platformSchema.table("consumed_events", {
  consumer: text("consumer").notNull(),
  eventId: uuid("event_id").notNull()
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
