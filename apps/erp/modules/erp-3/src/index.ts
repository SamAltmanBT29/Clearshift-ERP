import { erp3Resolver, Erp3ReferenceResolver } from "./public.js";
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
  type Erp3Repository,
  canonicalizeJson,
  computeRequestHash,
} from "./services/repository.js";
import * as domainRules from "./domain/index.js";

export {
  erp3Resolver,
  Erp3ReferenceResolver,
  buildApp,
  type AppOptions,
  Erp3Service,
  type Erp3ServiceOptions,
  DomainError,
  ConflictError,
  NotFoundError,
  ValidationError,
  InMemoryErp3Repository,
  type Erp3Repository,
  canonicalizeJson,
  computeRequestHash,
  domainRules,
};

export const moduleDefinition = {
  id: "erp3",
  schema: "erp3",
  routePrefix: "/api/v1/erp-orders",
  referenceResolvers: erp3Resolver,
};

export default moduleDefinition;
