import { z } from "zod";

export const EntityTypeEnum = z.enum([
  "customer",
  "vendor",
  "contact",
  "employee",
  "account",
  "deal"
]);

export type EntityType = z.infer<typeof EntityTypeEnum> | (string & {});

export const SecondaryIdentifiersSchema = z.record(z.string()).and(
  z.object({
    tax_id: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional()
  })
);

export type SecondaryIdentifiers = z.infer<typeof SecondaryIdentifiersSchema>;

export const GoldenIdStatusSchema = z.enum([
  "active",
  "needs_review",
  "merged"
]);

export type GoldenIdStatus = z.infer<typeof GoldenIdStatusSchema>;

export const GoldenIdRecordSchema = z.object({
  id: z.string().uuid("Primary Golden ID must be a valid UUID"),
  display_gid: z.string().regex(/^GID-[A-Z]+-[A-Z0-9]+$/, "Display GID must follow GID-<TYPE>-<ID> format"),
  entity_type: z.string().min(1),
  source_system: z.string().min(1),
  source_id: z.string().min(1),
  identifiers: SecondaryIdentifiersSchema.default({}),
  status: GoldenIdStatusSchema.default("active"),
  review_reason: z.string().optional(),
  conflicting_ids: z.array(z.string().uuid()).default([]),
  created_at: z.string(),
  updated_at: z.string()
});

export type GoldenIdRecord = z.infer<typeof GoldenIdRecordSchema>;

export const LookupGoldenIdRequestSchema = z.object({
  entity_type: z.string().min(1, "entity_type is required"),
  source_system: z.string().min(1, "source_system is required"),
  source_id: z.string().min(1, "source_id is required")
});

export type LookupGoldenIdRequest = z.infer<typeof LookupGoldenIdRequestSchema>;

export const UpsertGoldenIdRequestSchema = z.object({
  entity_type: z.string().min(1, "entity_type is required"),
  source_system: z.string().min(1, "source_system is required"),
  source_id: z.string().min(1, "source_id is required"),
  identifiers: SecondaryIdentifiersSchema.optional()
});

export type UpsertGoldenIdRequest = z.infer<typeof UpsertGoldenIdRequestSchema>;

export const GoldenIdResponseSchema = z.object({
  data: GoldenIdRecordSchema,
  is_new: z.boolean(),
  needs_review: z.boolean()
});

export type GoldenIdResponse = z.infer<typeof GoldenIdResponseSchema>;
