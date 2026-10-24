import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import * as jose from "jose";
import { Actions, Resources, Roles, type RoleType } from "@clearshift/contracts";
import { InMemoryAuditRepository, hasPermission } from "@cs/core";
import { getSigningKeys, signAccessToken } from "@cs/identity";
import { buildApp } from "../../src/app.js";
import { Erp3AuditService } from "../../src/services/audit.js";
import { isErp3PolicyAllowed, Erp3Policies } from "../../src/policies/authorization.js";
import { maskErp3SensitiveFields } from "../../src/policies/field-masking.js";

describe("ERP-3 authorization and sensitive data protection (#34)", () => {
  let app: FastifyInstance;
  let auditRepository: InMemoryAuditRepository;
  let auditService: Erp3AuditService;

  beforeEach(() => {
    auditRepository = new InMemoryAuditRepository();
    auditService = new Erp3AuditService(auditRepository);
    app = buildApp({ authRequired: true, auditService });
  });

  afterEach(async () => {
    await app.close();
  });

  async function token(role: RoleType, subject = `test-${role}`): Promise<string> {
    return signAccessToken(subject, [role]);
  }

  it("matches the SDS role matrix for reads, creates, updates, and migration loads", () => {
    const reads = [Roles.VIEWER, Roles.EDITOR, Roles.ADMIN];
    const creates = [Roles.EDITOR, Roles.MIGRATION_RUNNER, Roles.ADMIN];
    const deniedRead = [Roles.ANALYST, Roles.MIGRATION_RUNNER];
    const deniedCreate = [Roles.VIEWER, Roles.ANALYST];

    for (const policy of ["SALES_ORDERS_READ", "INVOICES_READ"] as const) {
      for (const role of reads) expect(isErp3PolicyAllowed([role], policy)).toBe(true);
      for (const role of deniedRead) expect(isErp3PolicyAllowed([role], policy)).toBe(false);
    }
    for (const role of creates) {
      expect(isErp3PolicyAllowed([role], "SALES_ORDERS_CREATE")).toBe(true);
      expect(isErp3PolicyAllowed([role], "INVOICES_CREATE")).toBe(true);
      expect(isErp3PolicyAllowed([role], "PAYMENTS_CREATE")).toBe(true);
    }
    for (const role of deniedCreate) {
      expect(isErp3PolicyAllowed([role], "SALES_ORDERS_CREATE")).toBe(false);
    }
    expect(isErp3PolicyAllowed([Roles.EDITOR], "SALES_ORDERS_UPDATE")).toBe(true);
    expect(isErp3PolicyAllowed([Roles.ADMIN], "SALES_ORDERS_UPDATE")).toBe(true);
    for (const role of [Roles.VIEWER, Roles.ANALYST, Roles.MIGRATION_RUNNER]) {
      expect(isErp3PolicyAllowed([role], "SALES_ORDERS_UPDATE")).toBe(false);
    }
    expect(isErp3PolicyAllowed([Roles.MIGRATION_RUNNER], "IMPORT_EXECUTE")).toBe(true);
    expect(isErp3PolicyAllowed([Roles.ADMIN], "IMPORT_EXECUTE")).toBe(true);
    expect(isErp3PolicyAllowed([Roles.EDITOR], "IMPORT_EXECUTE")).toBe(false);
    expect(hasPermission([Roles.ADMIN], Actions.EXPORT, Resources.ERP3_SALES_ORDERS)).toBe(true);
  });

  it("returns 401 for unauthenticated requests and 403 for authenticated forbidden requests", async () => {
    const unauthenticated = await app.inject({ method: "GET", url: "/api/v1/erp-orders/sales-orders" });
    expect(unauthenticated.statusCode).toBe(401);

    const analyst = await token(Roles.ANALYST);
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/erp-orders/sales-orders",
      headers: { authorization: `Bearer ${analyst}` },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("enforces read and status-update policies at the HTTP boundary", async () => {
    const viewer = await token(Roles.VIEWER);
    const read = await app.inject({
      method: "GET",
      url: "/api/v1/erp-orders/sales-orders/aaaaaaaa-0003-4000-8000-000000000001",
      headers: { authorization: `Bearer ${viewer}` },
    });
    expect(read.statusCode).toBe(200);

    const runner = await token(Roles.MIGRATION_RUNNER);
    const update = await app.inject({
      method: "PATCH",
      url: "/api/v1/erp-orders/sales-orders/aaaaaaaa-0003-4000-8000-000000000001",
      headers: { authorization: `Bearer ${runner}` },
      payload: { status: "Invoiced" },
    });
    expect(update.statusCode).toBe(403);
  });

  it("rejects expired tokens and tokens with an invalid issuer or audience", async () => {
    const keys = await getSigningKeys();
    const now = Math.floor(Date.now() / 1000);
    const makeToken = (issuer: string, audience: string, exp: number) => new jose.SignJWT({ roles: [Roles.EDITOR] })
      .setProtectedHeader({ alg: "EdDSA", kid: "cs-hub-key-v1" })
      .setIssuer(issuer).setAudience(audience).setSubject("test-user")
      .setJti("test-jti").setIssuedAt(now - 60).setExpirationTime(exp)
      .sign(keys.privateKey);

    for (const invalid of [
      await makeToken("clearshift-hub", "clearshift", now - 1),
      await makeToken("wrong-issuer", "clearshift", now + 60),
      await makeToken("clearshift-hub", "wrong-audience", now + 60),
    ]) {
      const response = await app.inject({
        method: "GET", url: "/api/v1/erp-orders/sales-orders",
        headers: { authorization: `Bearer ${invalid}` },
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it("rejects disabled users and writes an audit event without token data", async () => {
    const service = new Erp3AuditService(auditRepository);
    const disabledApp = buildApp({ authRequired: true, auditService: service, isUserDisabled: (id) => id === "disabled-user" });
    const signed = await signAccessToken("disabled-user", [Roles.EDITOR]);
    const response = await disabledApp.inject({
      method: "GET", url: "/api/v1/erp-orders/sales-orders",
      headers: { authorization: `Bearer ${signed}`, "x-correlation-id": "corr-disabled" },
    });
    expect(response.statusCode).toBe(401);
    const events = await service.query({ action: "auth.failed" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: "disabled-user", targetId: "disabled-user", correlationId: "corr-disabled", reason: "account_disabled" });
    expect(JSON.stringify(events)).not.toContain(signed);
    await disabledApp.close();
  });

  it("masks bank, salary, and credential values recursively before JSON serialization", () => {
    const source = {
      payment: { bank_account_number: "1234567890", access_token: "synthetic-token" },
      employee: { annual_salary: "125000" },
    };
    expect(maskErp3SensitiveFields(source, [Roles.VIEWER])).toEqual({
      payment: { bank_account_number: "XXXX-XXXX-7890", access_token: "[REDACTED]" },
      employee: { annual_salary: "XX,XXX" },
    });
    expect(maskErp3SensitiveFields(source, [Roles.ADMIN]).employee.annual_salary).toBe("125000");
  });

  it("applies masking to API JSON in the Fastify response hook", async () => {
    app.get("/security/probe", async () => ({
      bank_account_number: "1234567890",
      salary: "125000",
      access_token: "synthetic-token",
    }));
    const viewer = await token(Roles.VIEWER);
    const response = await app.inject({
      method: "GET", url: "/security/probe",
      headers: { authorization: `Bearer ${viewer}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      bank_account_number: "XXXX-XXXX-7890",
      salary: "XX,XXX",
      access_token: "[REDACTED]",
    });
  });

  it("records actor, action, correlation, and result without copying request fields", async () => {
    const editor = await token(Roles.EDITOR, "editor-1");
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/erp-orders/sales-orders/aaaaaaaa-0003-4000-8000-000000000001",
      headers: { authorization: `Bearer ${editor}`, "x-correlation-id": "corr-status" },
      payload: { status: "Invoiced" },
    });
    expect(response.statusCode).toBe(200);
    const events = await auditService.query({ action: "erp.sales_order.status_changed" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor: "editor-1", action: "erp.sales_order.status_changed", correlationId: "corr-status", result: "success", targetEntity: "sales_order" });
    expect(JSON.stringify(events)).not.toContain("1234567890");
  });

  describe("Object-Level Authorization Guards (Tenant & Cross-User Isolation)", () => {
    it("prevents cross-tenant access to sales orders with 403 OBJECT_ACCESS_DENIED", async () => {
      // 1. Create sales order under tenant-alpha
      const adminToken = await token(Roles.ADMIN, "admin-1");
      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        headers: {
          authorization: `Bearer ${adminToken}`,
          "x-tenant-id": "tenant-alpha",
        },
        payload: {
          order_number: "SO-TENANT-ALPHA-01",
          customer_golden_id: "55555555-0003-4000-8000-000000000001",
          order_date: "2026-04-10",
          currency: "USD",
          lines: [
            {
              product_id: "11111111-0001-4000-8000-000000000001",
              quantity: "1.0000",
              price: "50.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      });
      expect(createRes.statusCode).toBe(201);
      const createdOrder = createRes.json();

      // 2. Caller from tenant-beta attempts to read tenant-alpha order -> 403
      const viewerToken = await token(Roles.VIEWER, "viewer-beta");
      const readRes = await app.inject({
        method: "GET",
        url: `/api/v1/erp-orders/sales-orders/${createdOrder.id}`,
        headers: {
          authorization: `Bearer ${viewerToken}`,
          "x-tenant-id": "tenant-beta",
        },
      });
      expect(readRes.statusCode).toBe(403);
      expect(readRes.json().code).toBe("OBJECT_ACCESS_DENIED");

      // 3. Caller from tenant-alpha successfully reads it -> 200
      const alphaViewer = await token(Roles.VIEWER, "viewer-alpha");
      const alphaReadRes = await app.inject({
        method: "GET",
        url: `/api/v1/erp-orders/sales-orders/${createdOrder.id}`,
        headers: {
          authorization: `Bearer ${alphaViewer}`,
          "x-tenant-id": "tenant-alpha",
        },
      });
      expect(alphaReadRes.statusCode).toBe(200);
      expect(alphaReadRes.json().id).toBe(createdOrder.id);
    });

    it("prevents non-admin users from mutating records created by another user with 403 CROSS_USER_MUTATION_FORBIDDEN", async () => {
      // 1. User Alice creates sales order
      const aliceToken = await token(Roles.EDITOR, "user-alice");
      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/erp-orders/sales-orders",
        headers: {
          authorization: `Bearer ${aliceToken}`,
        },
        payload: {
          order_number: "SO-ALICE-MUTATION-01",
          customer_golden_id: "55555555-0003-4000-8000-000000000001",
          order_date: "2026-04-10",
          currency: "USD",
          lines: [
            {
              product_id: "11111111-0001-4000-8000-000000000001",
              quantity: "1.0000",
              price: "50.0000",
              tax_rate: "0.0000",
            },
          ],
        },
      });
      expect(createRes.statusCode).toBe(201);
      const createdOrder = createRes.json();

      // 2. User Bob (different editor) attempts to mutate Alice's order -> 403
      const bobToken = await token(Roles.EDITOR, "user-bob");
      const mutateRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/erp-orders/sales-orders/${createdOrder.id}`,
        headers: {
          authorization: `Bearer ${bobToken}`,
        },
        payload: {
          status: "Invoiced",
        },
      });
      expect(mutateRes.statusCode).toBe(403);
      expect(mutateRes.json().code).toBe("CROSS_USER_MUTATION_FORBIDDEN");

      // 3. User Alice can mutate her own order -> 200
      const aliceMutateRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/erp-orders/sales-orders/${createdOrder.id}`,
        headers: {
          authorization: `Bearer ${aliceToken}`,
        },
        payload: {
          status: "Invoiced",
        },
      });
      expect(aliceMutateRes.statusCode).toBe(200);
      expect(aliceMutateRes.json().status).toBe("Invoiced");

      // 4. Admin can mutate across users -> 200
      const adminToken = await token(Roles.ADMIN, "admin-supervisor");
      const adminMutateRes = await app.inject({
        method: "PATCH",
        url: `/api/v1/erp-orders/sales-orders/${createdOrder.id}`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          status: "Closed",
        },
      });
      expect(adminMutateRes.statusCode).toBe(200);
      expect(adminMutateRes.json().status).toBe("Closed");
    });
  });
});

