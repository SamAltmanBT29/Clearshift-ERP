/**
 * ERP-5 HR & Employees — Route Manifest
 *
 * The single source of truth for the module's route table. The navigation
 * hierarchy, the breadcrumb trail, the browser title and the React Router
 * route objects are all derived from this manifest, so a route can never
 * exist in one place and be missing from another.
 *
 * Architecture reference:
 *   - ClearShift V1 Master Architecture Spec §3.1 — `/erp5/{employees,departments,leave}`
 *   - ClearShift V1 Master Architecture Spec §6.1 — slot 16 target path `web/routes.tsx`
 *   - SDS ClearShift ERP v2.0 §4.9 — ERP-5 screens
 *
 * @module erp5/web/route-manifest
 */

/** The path prefix every ERP-5 screen lives under. */
export const ERP5_BASE_PATH = '/erp5';

/** The Hub login screen (Master Architecture Spec §3.1 — owner `platform`). */
export const HUB_LOGIN_PATH = '/login';

/** The module label used in the shell banner and in the breadcrumb trail. */
export const ERP5_MODULE_LABEL = 'HR & Employees';

/** The application name appended to every browser title. */
export const ERP5_APP_TITLE = 'ClearShift ERP';

/** The navigation groups of the module, in display order. */
export type Erp5NavGroupId = 'people' | 'reporting' | 'administration';

export interface Erp5NavGroup {
  readonly id: Erp5NavGroupId;
  readonly label: string;
}

/**
 * A single registered route.
 *
 * `path` is relative to {@link ERP5_BASE_PATH} and may contain one `:param`
 * segment. A descriptor with `group: null` is reachable but deliberately
 * absent from the navigation hierarchy — create and detail screens are
 * reached from their list screen, never from the primary navigation.
 */
export interface Erp5RouteDescriptor {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly title: string;
  readonly group: Erp5NavGroupId | null;
}

export const ERP5_NAV_GROUPS: readonly Erp5NavGroup[] = [
  { id: 'people', label: 'People' },
  { id: 'reporting', label: 'Reporting' },
  { id: 'administration', label: 'Administration' },
];

/**
 * The frozen route table of the module.
 *
 * The five resources are the module's public screen set: the three HR master
 * records named by Master Architecture Spec §3.1, the department/month
 * payroll aggregate (FR-ERP5-06) and the read-only Hub Identity projection
 * (Master Architecture Spec C3).
 */
export const ERP5_ROUTE_DESCRIPTORS: readonly Erp5RouteDescriptor[] = [
  {
    id: 'employees',
    path: 'employees',
    label: 'Employees',
    title: 'Employees',
    group: 'people',
  },
  {
    id: 'employees-create',
    path: 'employees/new',
    label: 'New employee',
    title: 'New employee',
    group: null,
  },
  {
    id: 'employees-detail',
    path: 'employees/:employeeId',
    label: 'Employee',
    title: 'Employee',
    group: null,
  },
  {
    id: 'departments',
    path: 'departments',
    label: 'Departments',
    title: 'Departments',
    group: 'people',
  },
  {
    id: 'departments-create',
    path: 'departments/new',
    label: 'New department',
    title: 'New department',
    group: null,
  },
  {
    id: 'departments-detail',
    path: 'departments/:departmentId',
    label: 'Department',
    title: 'Department',
    group: null,
  },
  {
    id: 'leave',
    path: 'leave',
    label: 'Leave records',
    title: 'Leave records',
    group: 'people',
  },
  {
    id: 'leave-create',
    path: 'leave/new',
    label: 'New leave record',
    title: 'New leave record',
    group: null,
  },
  {
    id: 'leave-detail',
    path: 'leave/:leaveId',
    label: 'Leave record',
    title: 'Leave record',
    group: null,
  },
  {
    id: 'payroll-totals',
    path: 'payroll-totals',
    label: 'Payroll totals',
    title: 'Payroll totals',
    group: 'reporting',
  },
  {
    id: 'identity-users',
    path: 'identity-users',
    label: 'Identity users',
    title: 'Identity users',
    group: 'administration',
  },
];

/** The absolute path of a registered route. */
export function erp5RoutePath(descriptor: Erp5RouteDescriptor): string {
  return `${ERP5_BASE_PATH}/${descriptor.path}`;
}

/** The absolute path of a registered route, addressed by its descriptor id. */
export function erp5RoutePathById(id: string): string {
  const descriptor = ERP5_ROUTE_DESCRIPTORS.find((candidate) => candidate.id === id);
  if (!descriptor) {
    throw new Error(`Unknown ERP-5 route descriptor: '${id}'`);
  }
  return erp5RoutePath(descriptor);
}

/** The navigation entries of the module — descriptors that declare a group. */
export function erp5NavItems(): Erp5RouteDescriptor[] {
  return ERP5_ROUTE_DESCRIPTORS.filter((descriptor) => descriptor.group !== null);
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith(':');
}

/**
 * Decodes a URL path segment, tolerating a malformed percent escape.
 *
 * A browser can hand the module any pathname, including one with a stray or
 * truncated escape such as `/erp5/employees/100%`. `decodeURIComponent` throws
 * a `URIError` on those, which would take down the whole shell — the document
 * title and the breadcrumb trail are derived from the same match. A malformed
 * segment is therefore kept verbatim: it is only ever used as a display label
 * and a route parameter, and the raw text is the honest representation of what
 * the operator asked for.
 */
function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Matches a pathname against the route table.
 *
 * A static segment always wins over a dynamic one, so `/erp5/employees/new`
 * resolves to the create screen and never to `/erp5/employees/:employeeId`.
 */
export function matchErp5Route(
  pathname: string
): { readonly descriptor: Erp5RouteDescriptor; readonly params: Readonly<Record<string, string>> } | null {
  const pathSegments = segmentsOf(pathname);

  if (pathSegments.length === 0 || pathSegments[0] !== 'erp5') {
    return null;
  }
  const routeSegments = pathSegments.slice(1);

  let best:
    | { readonly descriptor: Erp5RouteDescriptor; readonly params: Readonly<Record<string, string>> }
    | null = null;
  let bestStaticScore = -1;

  for (const descriptor of ERP5_ROUTE_DESCRIPTORS) {
    const patternSegments = segmentsOf(descriptor.path);
    if (patternSegments.length !== routeSegments.length) {
      continue;
    }

    const params: Record<string, string> = {};
    let staticScore = 0;
    let matched = true;

    for (let index = 0; index < patternSegments.length; index += 1) {
      const pattern = patternSegments[index] as string;
      const actual = routeSegments[index] as string;
      if (isDynamicSegment(pattern)) {
        params[pattern.slice(1)] = safeDecodeSegment(actual);
      } else if (pattern === actual) {
        staticScore += 1;
      } else {
        matched = false;
        break;
      }
    }

    if (matched && staticScore > bestStaticScore) {
      best = { descriptor, params };
      bestStaticScore = staticScore;
    }
  }

  return best;
}

/**
 * True when `pathname` belongs to the navigation entry at `navPath`.
 *
 * The match is segment-boundary aware, so `/erp5/employees` is active for
 * `/erp5/employees` and `/erp5/employees/8a1…` but never for
 * `/erp5/employees-archive`.
 */
export function isErp5PathActive(navPath: string, pathname: string): boolean {
  if (pathname === navPath) {
    return true;
  }
  return pathname.startsWith(`${navPath}/`);
}

/** The navigation entry that owns `pathname`, or `null` outside the module. */
export function findErp5NavItemForPath(pathname: string): Erp5RouteDescriptor | null {
  return (
    erp5NavItems().find((item) => isErp5PathActive(erp5RoutePath(item), pathname)) ?? null
  );
}

/**
 * Builds the breadcrumb trail for a pathname.
 *
 * The trail is `HR & Employees → <entity> → <record>`. A record identifier is
 * shown verbatim because it is the only handle the operator has on the row
 * until the detail screen (ERP5-21) renders the real attributes.
 */
export function buildErp5Breadcrumbs(
  pathname: string
): { label: string; href?: string; isCurrent?: boolean }[] {
  const trail: { label: string; href?: string; isCurrent?: boolean }[] = [
    { label: ERP5_MODULE_LABEL, href: ERP5_BASE_PATH },
  ];

  const pathSegments = segmentsOf(pathname);
  if (pathSegments.length < 2 || pathSegments[0] !== 'erp5') {
    trail[0] = { label: ERP5_MODULE_LABEL, href: ERP5_BASE_PATH, isCurrent: true };
    return trail;
  }

  const entity = findErp5NavItemForPath(pathname);
  if (!entity) {
    trail.push({ label: 'Not found', isCurrent: true });
    return trail;
  }

  const entityPath = erp5RoutePath(entity);
  trail.push({
    label: entity.label,
    ...(pathname === entityPath ? { isCurrent: true } : { href: entityPath }),
  });

  const remaining = segmentsOf(pathname).slice(2);
  remaining.forEach((segment, index) => {
    const isLast = index === remaining.length - 1;
    trail.push({
      // A record identifier is shown verbatim — it is the only handle the
      // operator has on the row until the detail screen (ERP5-21) renders
      // the real attributes.
      label: segment === 'new' ? 'New' : segment,
      isCurrent: isLast,
    });
  });

  return trail;
}

/**
 * The document title for a pathname.
 *
 * The title is the deepest static label of the matched route, so
 * `/erp5/employees/new` reads "New employee" while `/erp5/employees/8a1…`
 * reads "Employee" until the detail screen refines it (ERP5-21).
 */
export function resolveErp5DocumentTitle(pathname: string): string {
  const match = matchErp5Route(pathname);
  if (!match) {
    return `${ERP5_MODULE_LABEL} · ${ERP5_APP_TITLE}`;
  }
  return `${match.descriptor.title} · ${ERP5_APP_TITLE}`;
}
