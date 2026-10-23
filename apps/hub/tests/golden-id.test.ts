import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { AppError } from "@cs/kernel";
import { goldenIdStore } from "../src/golden-id/golden-id-store.js";
import { goldenIdRoutes } from "../src/routes/golden-id.js";

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(error.toEnvelope("test-corr-id"));
      return;
    }
    const err = error as any;
    reply.status(err.statusCode || 500).send({
      code: err.code || "INTERNAL_ERROR",
      message: err.message || "An error occurred"
    });
  });

  await app.register(goldenIdRoutes);
  await app.ready();
  return app;
}

describe("Golden ID Map & Idempotent Source Identity Service (PLT-07)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    goldenIdStore.reset();
    app = await buildTestApp();
  });

  describe("1. Idempotency & Repeatability", () => {
    it("returns the exact same Golden ID across repeated calls with identical source key", async () => {
      const payload = {
        entity_type: "customer",
        source_system: "salesforce",
        source_id: "SF-00109"
      };

      // 1. Initial upsert (creates new)
      const res1 = await app.inject({
        method: "POST",
        url: "/hub/golden-id/upsert",
        payload
      });
      expect(res1.statusCode).toBe(200);
      const body1 = JSON.parse(res1.body);
      expect(body1.is_new).toBe(true);
      expect(body1.data.id).toBeDefined();
      const firstId = body1.data.id;
      const firstGid = body1.data.display_gid;

      // 2. Second upsert (idempotent retrieval)
      const res2 = await app.inject({
        method: "POST",
        url: "/hub/golden-id/upsert",
        payload
      });
      expect(res2.statusCode).toBe(200);
      const body2 = JSON.parse(res2.body);
      expect(body2.is_new).toBe(false);
      expect(body2.data.id).toBe(firstId);
      expect(body2.data.display_gid).toBe(firstGid);

      // 3. Third lookup via lookup endpoint
      const res3 = await app.inject({
        method: "POST",
        url: "/hub/golden-id/lookup",
        payload
      });
      expect(res3.statusCode).toBe(200);
      const body3 = JSON.parse(res3.body);
      expect(body3.data.id).toBe(firstId);
      expect(body3.data.display_gid).toBe(firstGid);
    });
  });

  describe("2. Namespace Isolation Between Entity Types", () => {
    it("ensures different entity types with identical source system and ID do not collide", async () => {
      const customerPayload = {
        entity_type: "customer",
        source_system: "erp_sap",
        source_id: "10001"
      };

      const vendorPayload = {
        entity_type: "vendor",
        source_system: "erp_sap",
        source_id: "10001"
      };

      const resCust = await app.inject({
        method: "POST",
        url: "/hub/golden-id/upsert",
        payload: customerPayload
      });
      const resVend = await app.inject({
        method: "POST",
        url: "/hub/golden-id/upsert",
        payload: vendorPayload
      });

      const custBody = JSON.parse(resCust.body);
      const vendBody = JSON.parse(resVend.body);

      expect(custBody.data.id).not.toBe(vendBody.data.id);
      expect(custBody.data.display_gid).toContain("CUST");
      expect(vendBody.data.display_gid).toContain("VEND");
    });
  });

  describe("3. Concurrency Protection", () => {
    it("creates exactly one map row under high concurrent upsert calls for the same key", async () => {
      const payload = {
        entity_type: "customer",
        source_system: "hubspot",
        source_id: "HB-CONCURRENT-99"
      };

      // Fire 20 concurrent requests simultaneously
      const concurrencyPromises = Array.from({ length: 20 }, () =>
        app.inject({
          method: "POST",
          url: "/hub/golden-id/upsert",
          payload
        })
      );

      const responses = await Promise.all(concurrencyPromises);
      const ids = new Set<string>();
      let newCount = 0;

      for (const res of responses) {
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        ids.add(body.data.id);
        if (body.is_new) {
          newCount += 1;
        }
      }

      // Exactly ONE unique UUID was generated
      expect(ids.size).toBe(1);
      // Exactly ONE request observed is_new: true
      expect(newCount).toBe(1);
    });
  });

  describe("4. String Preservation Without Numeric Coercion", () => {
    it("preserves leading zeros and 64-bit integer values as exact strings", async () => {
      const leadingZeroPayload = {
        entity_type: "account",
        source_system: "legacy_gl",
        source_id: "00014020" // Leading zeroes must NOT be dropped to 14020
      };

      const hugeNumberPayload = {
        entity_type: "customer",
        source_system: "billing",
        source_id: "9007199254740993" // Exceeds Number.MAX_SAFE_INTEGER
      };

      const res1 = await app.inject({
        method: "POST",
        url: "/hub/golden-id/upsert",
        payload: leadingZeroPayload
      });
      const res2 = await app.inject({
        method: "POST",
        url: "/hub/golden-id/upsert",
        payload: hugeNumberPayload
      });

      const body1 = JSON.parse(res1.body);
      const body2 = JSON.parse(res2.body);

      expect(body1.data.source_id).toBe("00014020");
      expect(body2.data.source_id).toBe("9007199254740993");
    });
  });

  describe("5. Conflict Detection & No Fuzzy Auto-Merge", () => {
    it("opens a review candidate when secondary identifiers conflict instead of auto-merging", async () => {
      // 1. First customer registered from Salesforce
      const customer1 = {
        entity_type: "customer",
        source_system: "salesforce",
        source_id: "SF-CUST-1",
        identifiers: {
          tax_id: "12-3456789",
          email: "procurement@acme.corp",
          phone: "+1-555-0199"
        }
      };

      const res1 = await app.inject({
        method: "POST",
        url: "/hub/golden-id/upsert",
        payload: customer1
      });
      const body1 = JSON.parse(res1.body);
      expect(body1.data.status).toBe("active");
      const id1 = body1.data.id;

      // 2. Second customer from SAP with a different source_id but identical tax_id
      const customer2 = {
        entity_type: "customer",
        source_system: "sap",
        source_id: "SAP-CUST-2",
        identifiers: {
          tax_id: "12-3456789", // Conflicting tax_id!
          email: "billing@acme.corp"
        }
      };

      const res2 = await app.inject({
        method: "POST",
        url: "/hub/golden-id/upsert",
        payload: customer2
      });
      const body2 = JSON.parse(res2.body);

      // NON-NEGOTIABLE CONSTRAINT: No fuzzy auto-merge!
      // Must NOT assign id1 to customer2!
      expect(body2.data.id).not.toBe(id1);
      expect(body2.data.status).toBe("needs_review");
      expect(body2.needs_review).toBe(true);
      expect(body2.data.review_reason).toContain("Conflicting tax_id");
      expect(body2.data.conflicting_ids).toContain(id1);

      // 3. Query review candidates endpoint
      const reviewRes = await app.inject({
        method: "GET",
        url: "/hub/golden-id/review-candidates"
      });
      expect(reviewRes.statusCode).toBe(200);
      const reviewBody = JSON.parse(reviewRes.body);
      expect(reviewBody.count).toBeGreaterThanOrEqual(1);
      const candidate = reviewBody.candidates.find((c: any) => c.source_id === "SAP-CUST-2");
      expect(candidate).toBeDefined();
    });
  });

  describe("6. Display GID vs Primary Key & Not Found Semantics", () => {
    it("uses UUID format for primary key and GID prefix for display only", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/hub/golden-id/upsert",
        payload: {
          entity_type: "vendor",
          source_system: "quickbooks",
          source_id: "QB-VEND-88"
        }
      });

      const body = JSON.parse(res.body);
      // Primary ID is a 36-char UUID
      expect(body.data.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      // Display GID starts with GID-
      expect(body.data.display_gid).toMatch(/^GID-VEND-[A-F0-9]{8}$/);
    });

    it("returns HTTP 404 NOT_FOUND when looking up a nonexistent source key or UUID", async () => {
      const lookupRes = await app.inject({
        method: "POST",
        url: "/hub/golden-id/lookup",
        payload: {
          entity_type: "customer",
          source_system: "salesforce",
          source_id: "NONEXISTENT_9999"
        }
      });
      expect(lookupRes.statusCode).toBe(404);
      expect(JSON.parse(lookupRes.body).code).toBe("NOT_FOUND");

      const getByIdRes = await app.inject({
        method: "GET",
        url: "/hub/golden-id/00000000-0000-0000-0000-000000000000"
      });
      expect(getByIdRes.statusCode).toBe(404);
    });
  });
});
