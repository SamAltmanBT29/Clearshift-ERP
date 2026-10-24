/**
 * ERP-3 Sales Orders & Invoices — Fastify Application Factory.
 *
 * @module erp3/app
 */

import { randomUUID } from "node:crypto";
import fastify, { type FastifyInstance } from "fastify";
import { ZodError, type ZodIssue } from "zod";
import { AppError, type ReferenceResolver } from "@cs/kernel";
import { redactErrorMessage, redactSensitiveData } from "@cs/core";
import { Erp3DomainError } from "./domain/rules.js";
import { Erp3Service } from "./services/erp3.service.js";
import { Erp3AuditService } from "./services/audit.js";
import {
  InMemoryErp3Repository,
  type Erp3Repository,
} from "./services/repository.js";
import { authPlugin } from "./plugins/auth.js";
import { erp3FieldMaskingPlugin } from "./policies/field-masking.js";
import { erpOrdersRoutes } from "./routes/index.js";

export interface AppOptions {
  repository?: Erp3Repository | undefined;
  erp3Service?: Erp3Service | undefined;
  referenceResolver?: ReferenceResolver | undefined;
  auditService?: Erp3AuditService | undefined;
  authRequired?: boolean | undefined;
  isUserDisabled?: ((userId: string) => boolean | Promise<boolean>) | undefined;
  nowUtcDate?: (() => string) | undefined;
  strictDr1Exact4Dp?: boolean | undefined;
  allowDirectOpenToClosed?: boolean | undefined;
}

function resolveCorrelationId(
  headers: Record<string, string | string[] | undefined>,
): string {
  const corr = headers["x-correlation-id"];
  if (typeof corr === "string" && corr.trim().length > 0) {
    return corr.trim();
  }
  const reqId = headers["x-request-id"];
  if (typeof reqId === "string" && reqId.trim().length > 0) {
    return reqId.trim();
  }
  return randomUUID();
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = fastify({ logger: false });
  const repository = options.repository ?? new InMemoryErp3Repository(true);
  const auditService = options.auditService ?? new Erp3AuditService();
  const erp3Service =
    options.erp3Service ??
    new Erp3Service({
      repository,
      referenceResolver: options.referenceResolver,
      auditService,
      nowUtcDate: options.nowUtcDate,
      strictDr1Exact4Dp: options.strictDr1Exact4Dp,
      allowDirectOpenToClosed: options.allowDirectOpenToClosed,
    });


  app.addHook("onSend", async (request, reply) => {
    reply.header("x-correlation-id", resolveCorrelationId(request.headers));
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    const correlationId = resolveCorrelationId(request.headers);
    reply.header("x-correlation-id", correlationId);

    if (error instanceof AppError) {
      const errorTitle =
        error.statusCode === 400
          ? "Bad Request"
          : error.statusCode === 401
            ? "Unauthorized"
            : error.statusCode === 403
              ? "Forbidden"
              : error.statusCode === 404
                ? "Not Found"
                : error.statusCode === 409
                  ? "Conflict"
                  : error.statusCode === 422
                    ? "Unprocessable Entity"
                    : error.name;
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: errorTitle,
        code: error.code,
        message: redactErrorMessage(error),
        details: redactSensitiveData(
          Array.isArray(error.details)
            ? error.details
            : error.details
              ? [error.details]
              : [],
        ),
        correlation_id: correlationId,
      });
    }

    if (error instanceof Erp3DomainError) {
      return reply.status(422).send({
        statusCode: 422,
        error: "Unprocessable Entity",
        code: error.code,
        message: redactErrorMessage(error),
        details: [
          {
            ...(error.field ? { field: error.field } : {}),
            message: redactErrorMessage(error),
            code: error.code,
            ...redactSensitiveData(error.context),
          },
        ],
        correlation_id: correlationId,
      });
    }

    if (
      error instanceof ZodError ||
      (typeof error === "object" &&
        error !== null &&
        "issues" in error &&
        Array.isArray((error as { issues: unknown[] }).issues))
    ) {
      const zodErr = error as ZodError;
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        code: "VALIDATION_ERROR",
        message: redactErrorMessage(zodErr.issues[0]?.message ?? "Validation failed"),
        details: redactSensitiveData(
          zodErr.issues.map((issue: ZodIssue) => ({
            field: issue.path.join("."),
            message: issue.message,
            code: issue.code,
          })),
        ),
        correlation_id: correlationId,
      });
    }

    return reply.status(500).send({
      statusCode: 500,
      error: "Internal Server Error",
      code: "INTERNAL_SERVER_ERROR",
      message: "An unexpected internal error occurred.",
      details: [],
      correlation_id: correlationId,
    });
  });

  app.register(authPlugin, {
    authRequired: options.authRequired ?? true,
    auditService,
    ...(options.isUserDisabled ? { isUserDisabled: options.isUserDisabled } : {}),
  });
  app.register(erp3FieldMaskingPlugin);
  app.register(erpOrdersRoutes, {
    prefix: "/api/v1/erp-orders",
    erp3Service,
    auditService,
  });

  return app;
}
