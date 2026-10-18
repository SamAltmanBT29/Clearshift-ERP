import { erp2Resolver } from "./public.js";

export const moduleDefinition = {
  id: "erp2",
  schema: "erp2",
  routePrefix: "/api/v1/erp-vendors",
  referenceResolvers: erp2Resolver
};

export default moduleDefinition;
