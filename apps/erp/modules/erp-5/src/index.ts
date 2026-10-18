import { erp5Resolver } from "./public.js";

export const moduleDefinition = {
  id: "erp5",
  schema: "erp5",
  routePrefix: "/api/v1/erp-hr",
  referenceResolvers: erp5Resolver
};

export default moduleDefinition;
