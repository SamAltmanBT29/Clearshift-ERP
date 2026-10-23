import { describe, it, expect, beforeEach } from "vitest";
import { buildHrApp } from "../../src/app.js";
import { InMemoryHrRepository } from "../../src/services/in-memory.repository.js";
import { HrService } from "../../src/services/hr.service.js";
import { AuditService, InMemoryAuditRepository } from "@cs/core";
import { FIXTURE_DEPARTMENT_ENGINEERING } from "../../fixtures/index.js";

describe("ERP-5 Idempotent Replay Security", () => {
  let app;
  let repository;
  let hrService;

  beforeEach(async () => {
    repository = new InMemoryHrRepository(true);
    const auditService = new AuditService(new InMemoryAuditRepository());
    hrService = new HrService(repository, auditService);
    app = buildHrApp({ repository, hrService });
    await app.ready();
  });

  const createEmployee = async (token: string, body: any) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/erp-hr/employees",
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
    if (res.statusCode >= 400) {
      console.log(`[DEBUG] Request with token ${token} failed with ${res.statusCode}: ${res.payload}`);
    } else {
      console.log(`[DEBUG] Request with token ${token} succeeded with ${res.statusCode}. Payload: ${res.payload}`);
    }
    return res;
  };

  it("should mask salary on idempotent replay for non-admin roles", async () => {
    const employeeBody = {
      employee_no: "EMP-001",
      first_name: "John",
      last_name: "Doe",
      birth_date: "1990-01-01",
      join_date: "2020-01-01",
      department_id: FIXTURE_DEPARTMENT_ENGINEERING.id,
      job_title: "Engineer",
      salary: "100000.0000",
      currency_code: "USD",
      batch_id: "00000000-0000-0000-0000-000000000001",
      source_row: 1,
      idempotency_key: "key-001",
    };

    const res1 = await createEmployee("role:admin", employeeBody);
    expect(res1.statusCode).toBe(201);
    const data1 = JSON.parse(res1.payload);
    expect(data1.salary_display).toBe("100000.0000");

    const res2 = await createEmployee("role:editor", employeeBody);
    expect(res2.statusCode).toBe(200);
    const data2 = JSON.parse(res2.payload);
    expect(data2.salary_display).toBe("XX,XXX");
  });

  it("should show full salary on idempotent replay for ADMIN", async () => {
    const employeeBody = {
      employee_no: "EMP-002",
      first_name: "Jane",
      last_name: "Doe",
      birth_date: "1990-01-01",
      join_date: "2020-01-01",
      department_id: FIXTURE_DEPARTMENT_ENGINEERING.id,
      job_title: "Manager",
      salary: "120000.0000",
      currency_code: "USD",
      batch_id: "00000000-0000-0000-0000-000000000002",
      source_row: 2,
      idempotency_key: "key-002",
    };

    const res1 = await createEmployee("role:editor", employeeBody);
    expect(res1.statusCode).toBe(201);

    const res2 = await createEmployee("role:admin", employeeBody);
    expect(res2.statusCode).toBe(200);
    const data2 = JSON.parse(res2.payload);
    expect(data2.salary_display).toBe("XX,XXX");
  });
});