import { describe, it, expect } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { AppError } from "@cs/kernel";
import {
  Roles,
  RoleType,
  hasPermission,
  Actions,
  Resources,
  maskSensitiveFields,
  maskCsvRecord,
  maskLastDigits,
  maskGovernmentId
} from "../src/auth/permissions.js";
import {
  ROUTE_POLICIES,
  isRouteAllowed,
  requireRoutePolicy
} from "../../../apps/hub/src/policies/route-policy.js";
import { fieldMaskingPlugin } from "../../../apps/hub/src/policies/field-masking-policy.js";

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(error.toEnvelope("test-corr-id"));
      return;
    }
    const err = error as any;
    reply.status(err.statusCode || 500).send({
      code: err.code || "INTERNAL_ERROR",
      message: err.message || "An error occurred"
    });
  });

  // Mock authentication decorator
  app.decorateRequest("user", undefined);
  app.addHook("preHandler", async (request) => {
    const rolesHeader = request.headers["x-test-roles"] as string | undefined;
    if (rolesHeader) {
      request.user = {
        iss: "clearshift-hub",
        aud: "clearshift",
        sub: "usr-test-01",
        iat: Date.now() / 1000,
        exp: Date.now() / 1000 + 900,
        jti: "jti_test",
        kid: "cs-hub-key-v1",
        roles: rolesHeader.split(",") as RoleType[]
      };
    }
  });

  // Register field masking plugin
  await app.register(fieldMaskingPlugin);

  // Register test route groups
  for (const [policyId] of Object.entries(ROUTE_POLICIES)) {
    app.get(`/api/test/${policyId}`, { preHandler: [requireRoutePolicy(policyId)] }, async () => {
      return { status: "authorized", policyId };
    });
  }

  // Undeclared route to test Default Deny
  app.get("/api/test/undeclared-route", { preHandler: [requireRoutePolicy("undeclared.route")] }, async () => {
    return { status: "unreachable" };
  });

  // Sensitive data test endpoint
  app.get("/api/test/employee-record", async () => {
    return {
      id: "emp-001",
      name: "Alice Developer",
      salary: 120000,
      bank_account_number: "98765432109876",
      ssn: "123-45-6789",
      password_hash: "$argon2id$v=19$m=65536,t=3,p=4$fakehash",
      token: "secret_token_abc123"
    };
  });

  await app.ready();
  return app;
}

describe("Central Role and Field-Level Authorization Matrix (PLT-06)", () => {
  describe("1. Role Permission Matrix & Default Deny Invariant", () => {
    it("enforces default deny for undeclared routes or empty roles", () => {
      // Empty roles
      expect(hasPermission([], Actions.READ, Resources.ACCOUNTS)).toBe(false);
      expect(isRouteAllowed([], "finance.read")).toBe(false);

      // Undeclared route
      expect(isRouteAllowed([Roles.ADMIN], "nonexistent.route")).toBe(false);
      expect(isRouteAllowed([Roles.VIEWER], "nonexistent.route")).toBe(false);
    });

    it("verifies Viewer permissions: reads business records, cannot mutate or bulk load", () => {
      const viewer = [Roles.VIEWER];
      expect(hasPermission(viewer, Actions.READ, Resources.ACCOUNTS)).toBe(true);
      expect(hasPermission(viewer, Actions.READ, Resources.JOURNAL_ENTRIES)).toBe(true);
      expect(hasPermission(viewer, Actions.CREATE, Resources.JOURNAL_ENTRIES)).toBe(false);
      expect(hasPermission(viewer, Actions.UPDATE, Resources.ACCOUNTS)).toBe(false);
      expect(hasPermission(viewer, Actions.EXECUTE_BULK, Resources.OPENING_BALANCES)).toBe(false);
    });

    it("verifies Editor permissions: reads and creates/updates business records, cannot bulk load or approve merges", () => {
      const editor = [Roles.EDITOR];
      expect(hasPermission(editor, Actions.READ, Resources.ACCOUNTS)).toBe(true);
      expect(hasPermission(editor, Actions.CREATE, Resources.ACCOUNTS)).toBe(true);
      expect(hasPermission(editor, Actions.UPDATE, Resources.JOURNAL_ENTRIES)).toBe(true);
      expect(hasPermission(editor, Actions.EXECUTE_BULK, Resources.OPENING_BALANCES)).toBe(false);
      expect(hasPermission(editor, Actions.APPROVE_MERGE, Resources.MIGRATION_BATCHES)).toBe(false);
    });

    it("verifies Migration Runner permissions: executes bulk loads, CANNOT approve own merges", () => {
      const runner = [Roles.MIGRATION_RUNNER];
      expect(hasPermission(runner, Actions.EXECUTE_BULK, Resources.MIGRATION_BATCHES)).toBe(true);
      expect(hasPermission(runner, Actions.EXECUTE_BULK, Resources.OPENING_BALANCES)).toBe(true);
      expect(hasPermission(runner, Actions.EXECUTE_BULK, Resources.PAYROLL)).toBe(true);

      // NON-NEGOTIABLE CONSTRAINT: Migration Runner cannot approve its own merge/skip decisions
      expect(hasPermission(runner, Actions.APPROVE_MERGE, Resources.MIGRATION_BATCHES)).toBe(false);
      expect(hasPermission(runner, Actions.APPROVE_MERGE, Resources.MIGRATION_MERGES)).toBe(false);
    });

    it("verifies Analyst permissions: reads quality, control center, trial balance, and audit logs", () => {
      const analyst = [Roles.ANALYST];
      expect(hasPermission(analyst, Actions.READ, Resources.TRIAL_BALANCE)).toBe(true);
      expect(hasPermission(analyst, Actions.READ, Resources.CONTROL_CENTER)).toBe(true);
      expect(hasPermission(analyst, Actions.VIEW_AUDIT, Resources.AUDIT_LOGS)).toBe(true);
      expect(hasPermission(analyst, Actions.CREATE, Resources.ACCOUNTS)).toBe(false);
      expect(hasPermission(analyst, Actions.EXECUTE_BULK, Resources.OPENING_BALANCES)).toBe(false);
    });

    it("verifies Admin permissions: administrative route rights", () => {
      const admin = [Roles.ADMIN];
      expect(hasPermission(admin, Actions.READ, Resources.ACCOUNTS)).toBe(true);
      expect(hasPermission(admin, Actions.CREATE, Resources.ACCOUNTS)).toBe(true);
      expect(hasPermission(admin, Actions.APPROVE_MERGE, Resources.MIGRATION_MERGES)).toBe(true);
      expect(hasPermission(admin, Actions.MANAGE_USERS, Resources.USER_ACCOUNTS)).toBe(true);
    });
  });

  describe("2. Table-Driven Route Authorization Matrix Tests", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildTestApp();
    });

    // Test matrix definition: [routeId, role, expectedStatus]
    const testCases: [string, RoleType, number][] = [
      // Finance Read
      ["finance.read", Roles.VIEWER, 200],
      ["finance.read", Roles.EDITOR, 200],
      ["finance.read", Roles.ANALYST, 200],
      ["finance.read", Roles.ADMIN, 200],
      ["finance.read", Roles.MIGRATION_RUNNER, 403],

      // Finance Mutate
      ["finance.mutate", Roles.EDITOR, 200],
      ["finance.mutate", Roles.ADMIN, 200],
      ["finance.mutate", Roles.VIEWER, 403],
      ["finance.mutate", Roles.ANALYST, 403],
      ["finance.mutate", Roles.MIGRATION_RUNNER, 403],

      // Finance Bulk Opening Balances
      ["finance.bulk_opening_balances", Roles.MIGRATION_RUNNER, 200],
      ["finance.bulk_opening_balances", Roles.ADMIN, 200],
      ["finance.bulk_opening_balances", Roles.VIEWER, 403],
      ["finance.bulk_opening_balances", Roles.EDITOR, 403],
      ["finance.bulk_opening_balances", Roles.ANALYST, 403],

      // HR Mutate
      ["hr.mutate", Roles.EDITOR, 200],
      ["hr.mutate", Roles.ADMIN, 200],
      ["hr.mutate", Roles.VIEWER, 403],
      ["hr.mutate", Roles.MIGRATION_RUNNER, 403],

      // Migration Execute
      ["migration.execute", Roles.MIGRATION_RUNNER, 200],
      ["migration.execute", Roles.ADMIN, 200],
      ["migration.execute", Roles.VIEWER, 403],
      ["migration.execute", Roles.EDITOR, 403],

      // Migration Approve Merge: ADMIN ONLY
      ["migration.approve_merge", Roles.ADMIN, 200],
      ["migration.approve_merge", Roles.MIGRATION_RUNNER, 403],
      ["migration.approve_merge", Roles.VIEWER, 403],
      ["migration.approve_merge", Roles.EDITOR, 403],
      ["migration.approve_merge", Roles.ANALYST, 403],

      // Key Rotation: ADMIN ONLY
      ["hub.rotate_keys", Roles.ADMIN, 200],
      ["hub.rotate_keys", Roles.EDITOR, 403],
      ["hub.rotate_keys", Roles.VIEWER, 403]
    ];

    test.each(testCases)(
      "route '%s' accessed by '%s' returns HTTP %i",
      async (routeId, role, expectedStatus) => {
        const res = await app.inject({
          method: "GET",
          url: `/api/test/${routeId}`,
          headers: {
            "x-test-roles": role
          }
        });

        expect(res.statusCode).toBe(expectedStatus);
        if (expectedStatus === 403) {
          const body = JSON.parse(res.body);
          expect(body.code).toBe("FORBIDDEN");
        }
      }
    );

    it("denies unauthenticated direct API call (no roles header)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/test/finance.mutate"
      });
      expect(res.statusCode).toBe(401);
    });

    it("denies access to undeclared route under Default Deny policy", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/test/undeclared-route",
        headers: {
          "x-test-roles": Roles.ADMIN
        }
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("3. Sensitive-Field Masking (API & CSV)", () => {
    const rawEmployee = {
      id: "emp-001",
      name: "Robert Johnson",
      salary: 135000,
      hourly_rate: 65,
      bank_account_number: "12345678901234",
      iban: "GB29XABC10203012345678",
      ssn: "987-65-4321",
      tax_id: "88-1234567",
      password_hash: "$argon2id$v=19$m=65536,t=3,p=4$verysecretpasswordhash",
      token: "raw_secret_bearer_token"
    };

    it("redacts credentials and password hashes for ALL roles (including Admin)", () => {
      const adminMasked = maskSensitiveFields(rawEmployee, [Roles.ADMIN]);
      const viewerMasked = maskSensitiveFields(rawEmployee, [Roles.VIEWER]);

      expect(adminMasked.password_hash).toBe("[REDACTED]");
      expect(adminMasked.token).toBe("[REDACTED]");
      expect(viewerMasked.password_hash).toBe("[REDACTED]");
      expect(viewerMasked.token).toBe("[REDACTED]");
    });

    it("masks bank account numbers and IBAN for ALL roles (including Admin)", () => {
      const adminMasked = maskSensitiveFields(rawEmployee, [Roles.ADMIN]);
      const editorMasked = maskSensitiveFields(rawEmployee, [Roles.EDITOR]);

      // Keeps last 4 digits only
      expect(adminMasked.bank_account_number).toBe("****-****-1234");
      expect(adminMasked.iban).toBe("****-****-5678");
      expect(editorMasked.bank_account_number).toBe("****-****-1234");
      expect(editorMasked.iban).toBe("****-****-5678");
    });

    it("masks SSN and government tax identifiers for ALL roles (including Admin)", () => {
      const adminMasked = maskSensitiveFields(rawEmployee, [Roles.ADMIN]);
      const viewerMasked = maskSensitiveFields(rawEmployee, [Roles.VIEWER]);

      expect(adminMasked.ssn).toBe("***-**-4321");
      expect(adminMasked.tax_id).toBe("***-**-4567");
      expect(viewerMasked.ssn).toBe("***-**-4321");
      expect(viewerMasked.tax_id).toBe("***-**-4567");
    });

    it("grants salary visibility to Admin but strictly masks it for Viewer, Editor, and Analyst", () => {
      const adminMasked = maskSensitiveFields(rawEmployee, [Roles.ADMIN]);
      const viewerMasked = maskSensitiveFields(rawEmployee, [Roles.VIEWER]);
      const editorMasked = maskSensitiveFields(rawEmployee, [Roles.EDITOR]);
      const analystMasked = maskSensitiveFields(rawEmployee, [Roles.ANALYST]);
      const runnerMasked = maskSensitiveFields(rawEmployee, [Roles.MIGRATION_RUNNER]);

      // Admin has approved HR policy access to salary
      expect(adminMasked.salary).toBe(135000);
      expect(adminMasked.hourly_rate).toBe(65);

      // Non-Admin roles have salary masked
      expect(viewerMasked.salary).toBe(0);
      expect(editorMasked.salary).toBe(0);
      expect(analystMasked.salary).toBe(0);
      expect(runnerMasked.salary).toBe(0);
    });

    it("applies identical masking rules to CSV export records via maskCsvRecord", () => {
      const csvRecord = maskCsvRecord(rawEmployee, [Roles.VIEWER]);

      expect(csvRecord.password_hash).toBe("[REDACTED]");
      expect(csvRecord.token).toBe("[REDACTED]");
      expect(csvRecord.bank_account_number).toBe("****-****-1234");
      expect(csvRecord.ssn).toBe("***-**-4321");
      expect(csvRecord.salary).toBe(0);
    });

    it("masks responses through Fastify onSend hook based on request user roles", async () => {
      const app = await buildTestApp();

      // 1. Viewer access: salary masked, bank/ssn masked, password redacted
      const viewerRes = await app.inject({
        method: "GET",
        url: "/api/test/employee-record",
        headers: {
          "x-test-roles": Roles.VIEWER
        }
      });
      const viewerBody = JSON.parse(viewerRes.body);
      expect(viewerBody.salary).toBe(0);
      expect(viewerBody.bank_account_number).toBe("****-****-9876");
      expect(viewerBody.ssn).toBe("***-**-6789");
      expect(viewerBody.password_hash).toBe("[REDACTED]");

      // 2. Admin access: salary visible, bank/ssn masked, password redacted
      const adminRes = await app.inject({
        method: "GET",
        url: "/api/test/employee-record",
        headers: {
          "x-test-roles": Roles.ADMIN
        }
      });
      const adminBody = JSON.parse(adminRes.body);
      expect(adminBody.salary).toBe(120000);
      expect(adminBody.bank_account_number).toBe("****-****-9876");
      expect(adminBody.password_hash).toBe("[REDACTED]");
    });
  });
});
