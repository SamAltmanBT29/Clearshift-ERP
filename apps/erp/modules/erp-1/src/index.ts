import { erp1Resolver } from "./public.js";
import { erp1KitMetadata } from "./kit/field-registry.js";

export * from "./kit/field-registry.js";
export * from "./kit/rejection-context.js";
export * from "./migration/dirty-data-plan.js";

export const moduleDefinition = {
  id: "erp1",
  schema: "erp1",
  routePrefix: "/api/v1/erp-products",
  referenceResolvers: erp1Resolver,
  migrationMetadata: erp1KitMetadata,
};

export default moduleDefinition;

