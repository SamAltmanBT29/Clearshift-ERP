import { erp1Resolver } from "./public.js";

export const moduleDefinition = {
  id: "erp1",
  schema: "erp1",
  routePrefix: "/api/v1/erp-products",
  referenceResolvers: erp1Resolver
};

export default moduleDefinition;
