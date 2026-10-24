# ERP-3 security and authorization

ERP-3 uses the shared Hub Identity EdDSA access-token verifier. Tokens must have the configured Hub issuer and ClearShift audience and a valid, unexpired signature. Requests without a valid bearer token receive `401`; valid users without the route permission receive `403`. The embedding API supplies `isUserDisabled` from its Hub user status store so disabled accounts are rejected before the route runs.

## Route permissions

| Capability | Roles |
|---|---|
| Read sales orders, invoices, and payments | viewer, editor, admin |
| Create sales orders, invoices, and payments | editor, migration_runner, admin |
| Change a sales order status | editor, admin |
| Execute the migration import endpoint | migration_runner, admin |

Analyst and migration_runner do not receive interactive order/invoice/payment reads. The migration role can create/load records through the module API and cannot change order state. Permissions are enforced by route pre-handlers through the shared `@cs/core` matrix, which defaults to deny.

## Sensitive values and logs

Responses are masked in the Fastify `onSend` hook before JSON serialization. Bank values use `XXXX-XXXX-7890`; non-admin salary values use `XX,XXX`; credentials, secrets, and tokens are always redacted. The shared audit service additionally redacts metadata. API errors return sanitized messages and details, and unexpected errors return a fixed message without stacks or SQL.

Audit entries record actor, role when present, action, timestamp, correlation ID, entity, batch ID when applicable, and result. They do not copy request bodies or raw rows. The module records successful creates and state transitions, migration loads, authentication failures, and authorization denials. There are no ERP-3 export or merge-decision routes in this V1 module.

## Verification

Run the security and route checks from the repository root:

```bash
npx vitest run apps/erp/modules/erp-3/tests/security/authorization.test.ts
npm run typecheck
npm run lint
```

The tests use synthetic fixtures and signed test tokens. They cover the SDS role matrix, HTTP 401/403 behavior, disabled users, expired and issuer/audience-invalid tokens, masking, and audit metadata.
