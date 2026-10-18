import { erp4Resolver } from "./public.js";

export const moduleDefinition = {
  id: "erp4",
  schema: "erp4",
  routePrefix: "/api/v1/erp-finance",
  referenceResolvers: erp4Resolver
};

export default moduleDefinition;
