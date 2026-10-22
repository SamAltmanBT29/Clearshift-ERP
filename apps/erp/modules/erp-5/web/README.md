# ERP-5 HR & Employees — Module Frontend

The frontend of the ERP-5 HR & Employees module: the route table, the
navigation hierarchy, the layout shell and the authentication guard.

**Issue:** [#192](https://github.com/SamAltmanBT29/Clearshift-ERP/issues/192) —
`[ERP5-16] ERP-5 HR and Employees: Module route/page registration using the
shared shell`

**Architecture references**

| Document | What it fixes |
|---|---|
| ClearShift V1 Master Architecture Spec §3.1 | `/erp5/{employees,departments,leave}` route table |
| ClearShift V1 Master Architecture Spec §6.1 | Slot 16 — the target path `web/routes.tsx` |
| ClearShift V1 Master Architecture Spec C3 | The Hub owns identity; the module never owns credentials |
| SDS ClearShift ERP v2.0 §4.9 | The ERP-5 screens |
| `packages/contracts/openapi/erp-5.yaml` | The API the screens read from |

---

## 1. Layout

```
web/
├── src/
│   ├── index.ts                 public facade — what a host application imports
│   ├── route-manifest.ts        the frozen route table (single source of truth)
│   ├── routes.tsx               the React Router route objects
│   ├── auth/
│   │   ├── session.ts           the session adapter (opaque token + expiry)
│   │   └── RequireAuth.tsx      the authentication guard
│   ├── components/
│   │   ├── ModuleShell.tsx      the layout shell — landmarks, title, outline
│   │   ├── ModuleNav.tsx        the navigation hierarchy
│   │   └── ModuleBreadcrumbs.tsx the breadcrumb trail
│   ├── pages/                   the route targets
│   └── theme.css                the shell layout, on the shared design tokens
└── tests/                       Vitest + React Testing Library
```

The route manifest is the single source of truth. The navigation hierarchy,
the breadcrumb trail, the browser title and the route objects are all derived
from it, so a route can never exist in one place and be missing from another.

---

## 2. Route table

| Path | Screen | In the navigation |
|---|---|---|
| `/erp5` | Redirects to `/erp5/employees` | — |
| `/erp5/employees` | Employee list | **People** |
| `/erp5/employees/new` | Create an employee | — |
| `/erp5/employees/:employeeId` | Employee detail | — |
| `/erp5/departments` | Department list | **People** |
| `/erp5/departments/new` | Create a department | — |
| `/erp5/departments/:departmentId` | Department detail | — |
| `/erp5/leave` | Leave record list | **People** |
| `/erp5/leave/new` | Create a leave record | — |
| `/erp5/leave/:leaveId` | Leave record detail | — |
| `/erp5/payroll-totals` | Department/month payroll aggregates | **Reporting** |
| `/erp5/identity-users` | Read-only Hub Identity projection | **Administration** |
| `/erp5/*` | Not-found view, inside the shell | — |

Create and detail screens are deliberately absent from the navigation: they
are reached from their list screen, never from the primary navigation.

### Mounting the module

```tsx
import { createBrowserRouter } from 'react-router-dom';
import { erp5Routes } from '@cs/mod-erp5/web';

const router = createBrowserRouter([
  { path: '/login', element: <HubLoginScreen /> },
  ...erp5Routes,
]);
```

The module owns only the `/erp5` subtree. The `/login` route is owned by the
platform (Master Architecture Spec §3.1) and the host application registers
it.

---

## 3. The shell

Every screen renders inside `ModuleShell`, which owns:

- the `banner`, `navigation` and `main` landmarks,
- a **skip link** to the main region, first in the tab order,
- the navigation hierarchy with `aria-current="page"` on the owning entry,
- the breadcrumb trail,
- the browser title (`<Screen> · ClearShift ERP`).

The shell deliberately does not own the page heading — the page renders the
single `h1` through the shared `PageTitle` component of `@cs/ui`.

The layout is styled from the shared design tokens of `@cs/ui` (PLT-08). The
module adds no token of its own; `theme.css` imports the shared token sheet
rather than copying it.

---

## 4. Authentication

The Hub owns credential issuance and token validation. The module asks one
question — *is there a session?* — and treats the token as **opaque**:

- the access token is read from session storage under
  `clearshift.access_token`,
- the token is decoded far enough to read the `exp` claim, so an expired
  session never renders a screen the API will reject with a 401,
- the token is **never** verified in the browser. The API is the sole
  authority on authentication and authorization.

`RequireAuth` guards the whole module. A missing, malformed or expired session
is redirected to the platform login screen with the requested path preserved:

```
/erp5/employees  →  /login?returnTo=%2Ferp5%2Femployees
```

### What this issue does not do

**Role and capability enforcement is not implemented here.** The guard checks
authentication only. The shared role/capability matrix is applied
server-side, and the client-side policy lands with **ERP5-15**. The 403
forbidden view lands with **ERP5-19**.

---

## 5. Screen ownership

This issue registers the routes. The screens themselves are delivered by the
remaining Role 3 issues:

| Issue | Delivers |
|---|---|
| ERP5-17 | The collection tables |
| ERP5-18 | Search, filters and sorting |
| ERP5-19 | Loading, empty, error and access-denied states |
| ERP5-20 | The create forms |
| ERP5-21 | The detail views |
| ERP5-22 | The module metadata for the shared Migration Kit wizard |
| ERP5-23 | The module context in the shared reject review screen |

---

## 6. Tests

```bash
npx vitest run apps/erp/modules/erp-5/web
```

| Suite | Covers |
|---|---|
| `route-manifest.test.ts` | The route table, matching, the navigation state, the breadcrumbs, the browser title |
| `session.test.ts` | Token storage, claim decoding, session resolution and expiry |
| `public-facade.test.ts` | The exported surface a host application depends on |
| `routes.test.tsx` | Every route resolves inside the shell, in a real DOM |
| `module-shell.test.tsx` | Landmarks, keyboard navigation, the active state, the title, the guard |
| `module-nav.test.tsx` | The navigation fallback to the router location, and an empty navigation group |
| `environment.test.ts` | Every dependency the module added is resolvable from a clean install |

The three `.tsx` suites run in a jsdom environment. Vitest's jsdom environment
combines jsdom's `AbortController` with Node's `Request`, which undici refuses
to pair; `tests/support/jsdom-environment.ts` installs a minimal `Request` for
the duration of those suites. The shim is self-disabling — it probes the
environment first and does nothing when it is already consistent.

### Malformed URLs

A browser can hand the module any pathname. The route matcher decodes a
dynamic segment defensively: a malformed percent escape such as
`/erp5/employees/100%` is kept verbatim instead of throwing, so the shell
still renders the screen with its title and breadcrumb trail.
