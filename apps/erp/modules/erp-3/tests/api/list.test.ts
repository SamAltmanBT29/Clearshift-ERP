import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Roles, signAccessToken } from "@cs/identity";
import { buildApp } from "../../src/app.js";
import { InMemoryErp3Repository } from "../../src/services/repository.js";

const CUSTOMER = "55555555-0003-4000-8000-000000000001";
const PRODUCT = "11111111-0001-4000-8000-000000000001";

describe("ERP-3 list and read API (#27)", () => {
  let app: FastifyInstance;
  let strictApp: FastifyInstance;
  let repository: InMemoryErp3Repository;

  beforeEach(async () => {
    repository = new InMemoryErp3Repository(true);
    for (let index = 2; index <= 4; index += 1) {
      const id = `aaaaaaaa-0003-4000-8000-00000000000${index}`;
      await repository.createSalesOrder({
        id,
        order_number: `SO-2026-000${index}`,
        customer_golden_id: CUSTOMER,
        order_date: index === 3 ? "2026-04-04" : `2026-04-0${index}`,
        status: "Open",
        currency: "USD",
        total: "118.0000",
        lines: [{
          id: `bbbbbbbb-0003-4000-8000-00000000000${index}`,
          order_id: id,
          product_id: PRODUCT,
          quantity: "1.0000",
          price: "100.0000",
          tax_rate: "18.0000",
          tax_amount: "18.0000",
          line_total: "118.0000",
          created_at: "2026-04-01T00:00:00.000Z",
        }],
        source_system: null,
        source_id: null,
      });
    }
    app = buildApp({ repository, authRequired: false });
    strictApp = buildApp({ repository, authRequired: true });
    await Promise.all([app.ready(), strictApp.ready()]);
  });

  afterEach(async () => {
    await Promise.all([app.close(), strictApp.close()]);
  });

  it("returns a documented, stable, bounded sales-order page", async () => {
    const first = await app.inject({ method: "GET", url: "/api/v1/erp-orders/sales-orders?page=1&pageSize=2" });
    const second = await app.inject({ method: "GET", url: "/api/v1/erp-orders/sales-orders?page=2&pageSize=2" });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const firstBody = first.json();
    const secondBody = second.json();
    expect(firstBody).toMatchObject({ total: 4, page: 1, pageSize: 2, totalPages: 2 });
    expect(firstBody.data.map((item: { order_number: string }) => item.order_number)).toEqual(["SO-2026-0003", "SO-2026-0004"]);
    expect(secondBody.data.map((item: { id: string }) => item.id)).not.toContain(firstBody.data[0].id);
    expect(secondBody.data.map((item: { id: string }) => item.id)).not.toContain(firstBody.data[1].id);
  });

  it("filters sales orders server-side and returns a valid empty page", async () => {
    const filtered = await app.inject({ method: "GET", url: "/api/v1/erp-orders/sales-orders?search=so-2026-0003" });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().data).toHaveLength(1);
    expect(filtered.json().data[0].order_number).toBe("SO-2026-0003");

    const empty = await app.inject({ method: "GET", url: "/api/v1/erp-orders/invoices?search=does-not-exist" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
  });

  it("rejects invalid paging and ignores unknown query parameters", async () => {
    const invalid = await app.inject({ method: "GET", url: "/api/v1/erp-orders/sales-orders?pageSize=101" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe("VALIDATION_ERROR");

    const unknown = await app.inject({ method: "GET", url: "/api/v1/erp-orders/payments?untrusted=SELECT" });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json()).toMatchObject({ data: [], total: 0 });
  });

  it("returns the full embedded-line read model and standardized 404", async () => {
    const found = await app.inject({ method: "GET", url: "/api/v1/erp-orders/sales-orders/aaaaaaaa-0003-4000-8000-000000000001" });
    expect(found.statusCode).toBe(200);
    expect(found.json().lines).toHaveLength(1);

    const missing = await app.inject({ method: "GET", url: "/api/v1/erp-orders/invoices/aaaaaaaa-0003-4000-8000-000000000099" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("INVOICE_NOT_FOUND");
  });

  it("requires authentication and allows the viewer read capability", async () => {
    const unauthenticated = await strictApp.inject({ method: "GET", url: "/api/v1/erp-orders/sales-orders" });
    expect(unauthenticated.statusCode).toBe(401);

    const viewerToken = await signAccessToken("viewer-user", [Roles.VIEWER]);
    const permitted = await strictApp.inject({
      method: "GET",
      url: "/api/v1/erp-orders/sales-orders",
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(permitted.statusCode).toBe(200);
  });
});
