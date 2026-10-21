import { erp2Resolver } from "./public.js";
export * from "./public.js";
export * from "./app.js";
export * from "./services/repository.js";
export * from "./services/vendor.service.js";
export * from "./services/purchase-order.service.js";
export * from "./services/audit.js";
export * from "./policies/field-masking.js";
export * from "./policies/rbac.js";
export * from "./policies/status-transitions.js";
export * from "./plugins/auth.js";
export * from "./routes/index.js";
export * from "./client.js";

export const moduleDefinition = {
  id: "erp2",
  schema: "erp2",
  routePrefix: "/api/v1/erp-vendors",
  referenceResolvers: erp2Resolver
};

export default moduleDefinition;
