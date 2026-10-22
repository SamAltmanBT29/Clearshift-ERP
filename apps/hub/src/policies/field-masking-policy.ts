import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { maskSensitiveFields } from "@cs/core";

export const fieldMaskingPluginAsync: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onSend", async (request, _reply, payload) => {
    // Only parse and mask application/json payloads
    if (typeof payload === "string" && (payload.startsWith("{") || payload.startsWith("["))) {
      try {
        const parsed = JSON.parse(payload);
        const roles = request.user?.roles || [];
        const masked = maskSensitiveFields(parsed, roles);
        return JSON.stringify(masked);
      } catch {
        // If not valid JSON, leave as is
        return payload;
      }
    }
    return payload;
  });
};

export const fieldMaskingPlugin = fp(fieldMaskingPluginAsync, {
  name: "field-masking-plugin",
  fastify: "5.x"
});
