import { erp3Resolver } from "./public.js";

export const moduleDefinition = {
  id: "erp3",
  schema: "erp3",
  routePrefix: "/api/v1/erp-orders",
  referenceResolvers: erp3Resolver
};

export default moduleDefinition;
