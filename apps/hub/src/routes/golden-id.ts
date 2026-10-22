import { FastifyPluginAsync } from "fastify";
import { AppError } from "@cs/kernel";
import {
  LookupGoldenIdRequestSchema,
  UpsertGoldenIdRequestSchema
} from "@clearshift/contracts";
import { goldenIdStore } from "../golden-id/index.js";

export const goldenIdRoutes: FastifyPluginAsync = async (fastify) => {
  // Lookup Golden ID mapping with explicit Not Found semantics
  fastify.post("/hub/golden-id/lookup", async (request) => {
    const parseResult = LookupGoldenIdRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new AppError("VALIDATION_ERROR", parseResult.error.issues[0]?.message || "Invalid lookup payload", 400);
    }

    const { entity_type, source_system, source_id } = parseResult.data;
    const record = await goldenIdStore.lookup(entity_type, source_system, source_id);

    if (!record) {
      throw new AppError(
        "NOT_FOUND",
        `Golden ID not found for (${entity_type}, ${source_system}, ${source_id})`,
        404
      );
    }

    return { data: record };
  });

  // Idempotent Create or Upsert Golden ID mapping
  fastify.post("/hub/golden-id/upsert", async (request) => {
    const parseResult = UpsertGoldenIdRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new AppError("VALIDATION_ERROR", parseResult.error.issues[0]?.message || "Invalid upsert payload", 400);
    }

    const { entity_type, source_system, source_id, identifiers } = parseResult.data;
    const { record, is_new } = await goldenIdStore.upsert(
      entity_type,
      source_system,
      source_id,
      identifiers
    );

    return {
      data: record,
      is_new,
      needs_review: record.status === "needs_review"
    };
  });

  // Query Review Candidates (conflicting evidence requiring human review)
  fastify.get("/hub/golden-id/review-candidates", async () => {
    const candidates = await goldenIdStore.getReviewCandidates();
    return {
      candidates,
      count: candidates.length
    };
  });

  // Get Golden ID by authoritative UUID
  fastify.get<{ Params: { id: string } }>("/hub/golden-id/:id", async (request) => {
    const { id } = request.params;
    const record = await goldenIdStore.getById(id);

    if (!record) {
      throw new AppError("NOT_FOUND", `Golden ID record '${id}' not found`, 404);
    }

    return { data: record };
  });
};
