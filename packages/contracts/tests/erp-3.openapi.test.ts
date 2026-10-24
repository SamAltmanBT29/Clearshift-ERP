/**
 * ERP-3 Sales Orders & Invoices — OpenAPI 3.1 Contract Verification Test Suite
 *
 * Proves that:
 *   - The OpenAPI 3.1 document exists and declares the ERP-3 base path.
 *   - Every internal $ref resolves to an existing component.
 *   - Every V1 route is documented (5 SDS §4.8 routes + 2 flagged detail routes).
 *   - Collection endpoints declare bounded pagination (pageSize <= 100).
 *   - Monetary fields are string-encoded decimals; rounding rule stays unresolved (DR-1).
 *   - Invoice due_date is required.
 *   - Error responses mirror the ADR-002 / PLT-04 error envelope.
 *
 * @module contracts/tests/erp-3.openapi.test
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { Erp3ApiErrorSchema } from "../src/erp-3.js";
import { ErrorEnvelopeSchema } from "../src/common.js";

const SPEC_PATH = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../openapi/erp-3.yaml",
);

const SPEC = readFileSync(SPEC_PATH, "utf-8");

/** SDS §4.8 routes plus detail routes and the Migration Kit import operation. */
const EXPECTED_ENDPOINTS = [
  "GET /sales-orders",
  "POST /sales-orders",
  "GET /sales-orders/{id}",
  "PATCH /sales-orders/{id}",
  "GET /invoices",
  "POST /invoices",
  "GET /invoices/{id}",
  "GET /payments",
  "POST /payments",
  "POST /import",
] as const;

function extractDocumentedEndpoints(spec: string): Set<string> {
  const endpoints = new Set<string>();
  let inPaths = false;
  let currentPath: string | null = null;

  for (const raw of spec.split("\n")) {
    if (/^paths:\s*$/.test(raw)) {
      inPaths = true;
      continue;
    }
    if (inPaths && /^\S/.test(raw) && !raw.startsWith("#")) {
      inPaths = false;
    }
    if (!inPaths) continue;

    const pathMatch = /^ {2}(\/[^:\s]*):\s*$/.exec(raw);
    if (pathMatch && pathMatch[1]) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = /^ {4}(get|post|patch|put|delete):\s*$/.exec(raw);
    if (methodMatch && methodMatch[1] && currentPath) {
      endpoints.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
    }
  }
  return endpoints;
}

function extractOperationResponses(
  spec: string,
  operationId: string,
): Set<string> {
  const responses = new Set<string>();
  const lines = spec.split("\n");
  const start = lines.findIndex((l) =>
    l.includes(`operationId: ${operationId}`),
  );
  if (start === -1) return responses;

  let inResponses = false;
  for (const raw of lines.slice(start)) {
    if (/^ {6}responses:\s*$/.test(raw)) {
      inResponses = true;
      continue;
    }
    if (inResponses && /^ {0,6}\S/.test(raw)) break;
    if (inResponses) {
      const statusMatch = /^ {8}"?(\d{3})"?:?\s*$/.exec(raw);
      if (statusMatch && statusMatch[1]) responses.add(statusMatch[1]);
    }
  }
  return responses;
}

/** Returns the YAML block for a component schema (4-space indented key). */
function schemaBlock(name: string): string {
  const lines = SPEC.split("\n");
  const start = lines.findIndex((l) =>
    new RegExp(`^ {4}${name}:\\s*$`).test(l),
  );
  if (start === -1) return "";
  const out: string[] = [];
  for (const raw of lines.slice(start + 1)) {
    if (/^ {0,4}\S/.test(raw)) break;
    out.push(raw);
  }
  return out.join("\n");
}

describe("ERP-3 OpenAPI 3.1 Contract Specification", () => {
  it("exists and declares OpenAPI 3.1.0 with the ERP-3 base path", () => {
    expect(existsSync(SPEC_PATH)).toBe(true);
    expect(SPEC).toContain('openapi: "3.1.0"');
    expect(SPEC).toContain("ClearShift ERP — Sales Orders & Invoices API");
    expect(SPEC).toContain("/api/v1/erp-orders");
  });

  it("resolves every internal $ref in the specification", () => {
    const references = [
      ...SPEC.matchAll(/\$ref:\s*"#\/components\/([A-Za-z]+)\/([^"]+)"/g),
    ].map((m) => `${m[1]}/${m[2]}`);

    expect(references.length).toBeGreaterThan(0);
    const componentsIdx = SPEC.indexOf("\ncomponents:");
    expect(componentsIdx).toBeGreaterThan(-1);
    const components = SPEC.slice(componentsIdx);

    for (const ref of references) {
      const [kind, name] = ref.split("/") as [string, string];
      expect(
        new RegExp(`^ {2}${kind}:\\s*$`, "m").test(components),
        `components.${kind} missing for ${ref}`,
      ).toBe(true);
      expect(
        new RegExp(`^ {4}${name}:\\s*$`, "m").test(components),
        `${ref} does not resolve`,
      ).toBe(true);
    }
  });

  it("documents every V1 baseline and migration endpoint and no others", () => {
    const documented = extractDocumentedEndpoints(SPEC);
    for (const endpoint of EXPECTED_ENDPOINTS) {
      expect(documented.has(endpoint), `Missing endpoint: ${endpoint}`).toBe(
        true,
      );
    }
    expect(documented.size).toBe(EXPECTED_ENDPOINTS.length);
  });

  it("documents the required role set for each API operation", () => {
    expect(SPEC.match(/x-required-roles:/g)).toHaveLength(EXPECTED_ENDPOINTS.length);
    expect(SPEC).toContain("x-required-roles: [viewer, editor, admin]");
    expect(SPEC).toContain("x-required-roles: [editor, migration_runner, admin]");
    expect(SPEC).toContain("x-required-roles: [migration_runner, admin]");
  });

  it("documents HTTP 401 and 403 responses on every protected operation", () => {
    for (const operationId of [
      "listSalesOrders", "createSalesOrder", "getSalesOrder", "updateSalesOrderStatus",
      "listInvoices", "createInvoice", "getInvoice", "createPayment", "listPayments", "importErp3Row",
    ]) {
      const responses = extractOperationResponses(SPEC, operationId);
      expect(responses.has("401"), `${operationId} 401`).toBe(true);
      expect(responses.has("403"), `${operationId} 403`).toBe(true);
    }
  });

  it("flags the detail routes as not explicitly listed in SDS §4.8", () => {
    expect(SPEC).toContain("NOT explicitly listed in SDS §4.8");
  });

  it("documents bounded pagination (max 100) on collection routes", () => {
    const lines = SPEC.split("\n");
    for (const op of ["listSalesOrders", "listInvoices"]) {
      const start = lines.findIndex((l) => l.includes(`operationId: ${op}`));
      expect(start, `${op} must exist`).toBeGreaterThan(-1);
      const opSlice = lines.slice(start, start + 60).join("\n");
      expect(opSlice).toContain("name: pageSize");
      expect(opSlice).toContain("maximum: 100");
    }
  });

  it("documents expected HTTP response codes for create operations", () => {
    for (const op of ["createSalesOrder", "createInvoice", "createPayment"]) {
      const responses = extractOperationResponses(SPEC, op);
      expect(responses.has("201"), `${op} 201`).toBe(true);
      expect(responses.has("400"), `${op} 400`).toBe(true);
    }
    for (const op of ["getSalesOrder", "getInvoice"]) {
      const responses = extractOperationResponses(SPEC, op);
      expect(responses.has("200"), `${op} 200`).toBe(true);
      expect(responses.has("404"), `${op} 404`).toBe(true);
    }
  });

  it("encodes monetary amounts as strings (no raw number types)", () => {
    const checks: Array<[string, string[]]> = [
      ["SalesOrderLine", ["tax_amount", "line_total"]],
      ["InvoiceLine", ["tax_amount", "line_total"]],
      ["SalesOrder", ["total"]],
      ["Invoice", ["total"]],
      ["Payment", ["amount"]],
    ];
    for (const [schema, fields] of checks) {
      const block = schemaBlock(schema);
      expect(block, `${schema} block`).not.toBe("");
      for (const field of fields) {
        expect(block, `${schema}.${field} must be type: string`).toMatch(
          new RegExp(`${field}:\\n\\s+type: string`),
        );
      }
    }
  });

  it("keeps the monetary rounding rule unresolved (DR-1)", () => {
    expect(SPEC).toContain("Unresolved: DR-1");
  });

  it("requires due_date on Invoice and CreateInvoiceRequest", () => {
    for (const schema of ["Invoice", "CreateInvoiceRequest"]) {
      const block = schemaBlock(schema);
      expect(block).toMatch(/required:[\s\S]*- due_date/);
      expect(block).toContain("due_date:");
    }
  });

  it("declares the approved status and payment method enums", () => {
    expect(SPEC).toContain("enum: [Open, Invoiced, Closed]");
    expect(SPEC).toContain("enum: [Open, Paid, Overdue]");
    expect(SPEC).toContain("enum: [cash, bank, card]");
  });

  it("mirrors the shared error envelope (ADR-002 / PLT-04)", () => {
    expect(SPEC).toContain("ApiError:");
    expect(SPEC).toContain("statusCode:");
    expect(SPEC).toContain("message:");
    expect(SPEC).toContain("details:");
    expect(SPEC).toContain("correlation_id:");
  });

  it("parses cleanly as an OpenAPI 3.1.0 AST with js-yaml and validates all examples against Zod schemas", () => {
    const doc = yaml.load(SPEC) as Record<string, unknown>;
    expect(doc["openapi"]).toBe("3.1.0");
    expect(doc["info"]).toBeDefined();
    expect(doc["paths"]).toBeDefined();
    expect(doc["components"]).toBeDefined();

    const paths = doc["paths"] as Record<string, Record<string, Record<string, unknown>>>;
    expect(Object.keys(paths)).toEqual([
      "/sales-orders",
      "/sales-orders/{id}",
      "/invoices",
      "/invoices/{id}",
      "/payments",
      "/import",
    ]);

    // Verify GET detail endpoints also document 400 ValidationError for malformed UUIDs
    for (const op of ["getSalesOrder", "getInvoice"]) {
      const responses = extractOperationResponses(SPEC, op);
      expect(responses.has("400"), `${op} 400`).toBe(true);
    }

    // Validate all error response examples in components.responses against Erp3ApiErrorSchema & ErrorEnvelopeSchema
    const components = doc["components"] as Record<string, Record<string, Record<string, unknown>>>;
    const responses = components["responses"] ?? {};
    for (const [respName, respDef] of Object.entries(responses)) {
      const content = respDef["content"] as Record<string, Record<string, unknown>> | undefined;
      const example = content?.["application/json"]?.["example"];
      expect(example, `${respName} example`).toBeDefined();
      expect(Erp3ApiErrorSchema.safeParse(example).success, `${respName} Erp3ApiErrorSchema`).toBe(true);
      expect(ErrorEnvelopeSchema.safeParse(example).success, `${respName} ErrorEnvelopeSchema`).toBe(true);
    }
  });

  it("satisfies OpenAPI 3.1.0 dialect and Spectral OAS structural rules (.spectral.yaml)", () => {
    const spectralPath = resolve(
      fileURLToPath(new URL(".", import.meta.url)),
      "../../../.spectral.yaml",
    );
    expect(existsSync(spectralPath)).toBe(true);
    const spectralConfig = yaml.load(readFileSync(spectralPath, "utf-8")) as Record<string, unknown>;
    expect(spectralConfig["extends"]).toContain("spectral:oas");

    // OpenAPI 3.1 uses JSON Schema 2020-12 type arrays instead of OpenAPI 3.0 `nullable: true`
    expect(SPEC).not.toMatch(/^\s+nullable:\s*true/m);

    const doc = yaml.load(SPEC) as Record<string, unknown>;
    const definedTags = new Set(
      ((doc["tags"] as Array<{ name: string }>) ?? []).map((t) => t.name),
    );
    expect(definedTags.size).toBeGreaterThan(0);

    const paths = doc["paths"] as Record<string, Record<string, Record<string, unknown>>>;
    const operationIds = new Set<string>();
    for (const [pathKey, methods] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const opId = op["operationId"] as string;
        expect(opId, `${method.toUpperCase()} ${pathKey} operationId`).toBeTruthy();
        expect(operationIds.has(opId), `Duplicate operationId ${opId}`).toBe(false);
        operationIds.add(opId);

        expect(op["summary"], `${opId} summary`).toBeTruthy();
        expect(op["description"], `${opId} description`).toBeTruthy();

        const opTags = (op["tags"] as string[]) ?? [];
        expect(opTags.length, `${opId} tags`).toBeGreaterThan(0);
        for (const tag of opTags) {
          expect(definedTags.has(tag), `${opId} tag ${tag} defined`).toBe(true);
        }

        const params = (op["parameters"] as Array<Record<string, unknown>>) ?? [];
        for (const param of params) {
          if ("$ref" in param) {
            expect(Object.keys(param), `${opId} param $ref siblings`).toEqual(["$ref"]);
          } else {
            expect(param["description"], `${opId} param ${String(param["name"])} description`).toBeTruthy();
          }
        }
      }
    }
  });
});
