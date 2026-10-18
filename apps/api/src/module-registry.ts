import { FastifyInstance } from "fastify";
import erp1 from "@cs/mod-erp1";
import erp2 from "@cs/mod-erp2";
import erp3 from "@cs/mod-erp3";
import erp4 from "@cs/mod-erp4";
import erp5 from "@cs/mod-erp5";

export const ALL_MODULES = [
  erp1,
  erp2,
  erp3,
  erp4,
  erp5
];

export async function registerBusinessModules(fastify: FastifyInstance): Promise<void> {
  for (const mod of ALL_MODULES) {
    // Strip leading /api/v1 when mounting under /api/v1 router context
    const cleanPrefix = mod.routePrefix.replace(/^\/api\/v1/, "");
    fastify.register(async (modInstance) => {
      // Diagnostic / module manifest endpoint
      modInstance.get("/manifest", async () => {
        return {
          id: mod.id,
          schema: mod.schema,
          status: "active",
          route_prefix: mod.routePrefix,
          timestamp: new Date().toISOString()
        };
      });
    }, { prefix: cleanPrefix });
  }
}
