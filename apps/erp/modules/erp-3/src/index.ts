import {
  erp3Resolver,
  Erp3ReferenceResolver,
  type SalesOrderPublicSummary,
  type InvoicePublicSummary,
  type PaymentPublicSummary,
} from "./public.js";
import { buildApp, type AppOptions } from "./app.js";
import {
  Erp3Service,
  type Erp3ServiceOptions,
  DomainError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "./services/erp3.service.js";
import {
  InMemoryErp3Repository,
  DrizzleErp3Repository,
  type Erp3Repository,
  canonicalizeJson,
  computeRequestHash,
} from "./services/repository.js";
import { erpOrdersRoutes } from "./routes/index.js";
import * as domainRules from "./domain/index.js";

export * from "./domain/index.js";

export {
  erp3Resolver,
  Erp3ReferenceResolver,
  type SalesOrderPublicSummary,
  type InvoicePublicSummary,
  type PaymentPublicSummary,
  buildApp,
  type AppOptions,
  Erp3Service,
  type Erp3ServiceOptions,
  DomainError,
  ConflictError,
  NotFoundError,
  ValidationError,
  InMemoryErp3Repository,
  DrizzleErp3Repository,
  type Erp3Repository,
  canonicalizeJson,
  computeRequestHash,
  erpOrdersRoutes,
  domainRules,
};

export const moduleDefinition = {
  id: "erp3",
  schema: "erp3",
  routePrefix: "/api/v1/erp-orders",
  referenceResolvers: erp3Resolver,
  routes: erpOrdersRoutes,
};

export const erp3Descriptor = moduleDefinition;

export default moduleDefinition;
