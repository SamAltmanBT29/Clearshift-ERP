/**
 * ERP-3 Sales Orders and Invoices — Route Manifest
 *
 * The single source of truth for the module's route table. The navigation
 * hierarchy, the breadcrumb trail, the browser title and the React Router
 * route objects are all derived from this manifest, so a route can never
 * exist in one place and be missing from another.
 *
 * Architecture reference:
 *   - ClearShift V1 Master Architecture Spec §3.1 — `/erp3/{sales-orders,invoices,payments}`
 *   - ClearShift V1 Master Architecture Spec §6.1 — slot 16 target path `web/routes.tsx`
 *   - SDS ClearShift ERP v2.0 §4.7 — ERP-3 screens
 *
 * @module erp3/web/route-manifest
 */

/** The path prefix every ERP-3 screen lives under. */
export const ERP3_BASE_PATH = '/erp3';

/** The Hub login screen (Master Architecture Spec §3.1 — owner `platform`). */
export const HUB_LOGIN_PATH = '/login';

/** The module label used in the shell banner and in the breadcrumb trail. */
export const ERP3_MODULE_LABEL = 'Sales Orders & Invoices';

/** The application name appended to every browser title. */
export const ERP3_APP_TITLE = 'ClearShift ERP';

/** The navigation groups of the module, in display order. */
export type Erp3NavGroupId = 'sales' | 'billing';

export interface Erp3NavGroup {
  readonly id: Erp3NavGroupId;
  readonly label: string;
}

/**
 * A single registered route.
 *
 * `path` is relative to {@link ERP3_BASE_PATH} and may contain one `:param`
 * segment. A descriptor with `group: null` is reachable but deliberately
 * absent from the navigation hierarchy — create and detail screens are
 * reached from their list screen, never from the primary navigation.
 */
export interface Erp3RouteDescriptor {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly title: string;
  readonly group: Erp3NavGroupId | null;
}

export const ERP3_NAV_GROUPS: readonly Erp3NavGroup[] = [
  { id: 'sales', label: 'Sales' },
  { id: 'billing', label: 'Billing & Payments' },
];

/**
 * The frozen route table of the module.
 *
 * Bound to Sales orders, order lines, invoices, invoice lines and payments
 * (Master Architecture Spec §3.1 `/erp3/{sales-orders,invoices,payments}`).
 */
export const ERP3_ROUTE_DESCRIPTORS: readonly Erp3RouteDescriptor[] = [
  {
    id: 'sales-orders',
    path: 'sales-orders',
    label: 'Sales orders',
    title: 'Sales orders',
    group: 'sales',
  },
  {
    id: 'sales-orders-create',
    path: 'sales-orders/new',
    label: 'New sales order',
    title: 'New sales order',
    group: null,
  },
  {
    id: 'sales-orders-detail',
    path: 'sales-orders/:orderId',
    label: 'Sales order',
    title: 'Sales order',
    group: null,
  },
  {
    id: 'sales-orders-edit',
    path: 'sales-orders/:orderId/edit',
    label: 'Edit sales order',
    title: 'Edit sales order',
    group: null,
  },
  {
    id: 'invoices',
    path: 'invoices',
    label: 'Invoices',
    title: 'Invoices',
    group: 'billing',
  },
  {
    id: 'invoices-create',
    path: 'invoices/new',
    label: 'New invoice',
    title: 'New invoice',
    group: null,
  },
  {
    id: 'invoices-detail',
    path: 'invoices/:invoiceId',
    label: 'Invoice',
    title: 'Invoice',
    group: null,
  },
  {
    id: 'invoices-edit',
    path: 'invoices/:invoiceId/edit',
    label: 'Edit invoice',
    title: 'Edit invoice',
    group: null,
  },
  {
    id: 'payments',
    path: 'payments',
    label: 'Payments',
    title: 'Payments',
    group: 'billing',
  },
];

/** The absolute path of a registered route. */
export function erp3RoutePath(descriptor: Erp3RouteDescriptor): string {
  return `${ERP3_BASE_PATH}/${descriptor.path}`;
}

/** The absolute path of a registered route, addressed by its descriptor id. */
export function erp3RoutePathById(id: string): string {
  const descriptor = ERP3_ROUTE_DESCRIPTORS.find((candidate) => candidate.id === id);
  if (!descriptor) {
    throw new Error(`Unknown ERP-3 route descriptor: '${id}'`);
  }
  return erp3RoutePath(descriptor);
}

/** The navigation entries of the module — descriptors that declare a group. */
export function erp3NavItems(): Erp3RouteDescriptor[] {
  return ERP3_ROUTE_DESCRIPTORS.filter((descriptor) => descriptor.group !== null);
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
 * truncated escape such as `/erp3/sales-orders/100%`. `decodeURIComponent` throws
 * a `URIError` on those, which would take down the whole shell. A malformed
 * segment is therefore kept verbatim: it is only ever used as a display label
 * and a route parameter.
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
 * A static segment always wins over a dynamic one, so `/erp3/sales-orders/new`
 * resolves to the create screen and never to `/erp3/sales-orders/:orderId`.
 */
export function matchErp3Route(
  pathname: string
): { readonly descriptor: Erp3RouteDescriptor; readonly params: Readonly<Record<string, string>> } | null {
  const pathSegments = segmentsOf(pathname);

  if (pathSegments.length === 0 || pathSegments[0] !== 'erp3') {
    return null;
  }
  const routeSegments = pathSegments.slice(1);

  let best:
    | { readonly descriptor: Erp3RouteDescriptor; readonly params: Readonly<Record<string, string>> }
    | null = null;
  let bestStaticScore = -1;

  for (const descriptor of ERP3_ROUTE_DESCRIPTORS) {
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
 * The match is segment-boundary aware, so `/erp3/sales-orders` is active for
 * `/erp3/sales-orders` and `/erp3/sales-orders/ord-123` but never for
 * `/erp3/sales-orders-archive`.
 */
export function isErp3PathActive(navPath: string, pathname: string): boolean {
  if (pathname === navPath) {
    return true;
  }
  return pathname.startsWith(`${navPath}/`);
}

/** The navigation entry that owns `pathname`, or `null` outside the module. */
export function findErp3NavItemForPath(pathname: string): Erp3RouteDescriptor | null {
  return (
    erp3NavItems().find((item) => isErp3PathActive(erp3RoutePath(item), pathname)) ?? null
  );
}

/** The literal path steps of the module, as they read in a breadcrumb. */
const SEGMENT_LABELS: Readonly<Record<string, string>> = {
  new: 'New',
  edit: 'Edit',
};

/**
 * Builds the breadcrumb trail for a pathname.
 *
 * The trail is `Sales Orders & Invoices → <entity> → <record>`.
 */
export function buildErp3Breadcrumbs(
  pathname: string
): { label: string; href?: string; isCurrent?: boolean }[] {
  const trail: { label: string; href?: string; isCurrent?: boolean }[] = [
    { label: ERP3_MODULE_LABEL, href: ERP3_BASE_PATH },
  ];

  const pathSegments = segmentsOf(pathname);
  if (pathSegments.length < 2 || pathSegments[0] !== 'erp3') {
    trail[0] = { label: ERP3_MODULE_LABEL, href: ERP3_BASE_PATH, isCurrent: true };
    return trail;
  }

  const entity = findErp3NavItemForPath(pathname);
  if (!entity) {
    trail.push({ label: 'Not found', isCurrent: true });
    return trail;
  }

  const entityPath = erp3RoutePath(entity);
  trail.push({
    label: entity.label,
    ...(pathname === entityPath ? { isCurrent: true } : { href: entityPath }),
  });

  const remaining = segmentsOf(pathname).slice(2);
  remaining.forEach((segment, index) => {
    const isLast = index === remaining.length - 1;
    trail.push({
      label: SEGMENT_LABELS[segment] ?? segment,
      isCurrent: isLast,
    });
  });

  return trail;
}

/**
 * The document title for a pathname.
 *
 * The title is the deepest static label of the matched route, so
 * `/erp3/sales-orders/new` reads "New sales order · ClearShift ERP" while
 * `/erp3/sales-orders/ord-1` reads "Sales order · ClearShift ERP".
 */
export function resolveErp3DocumentTitle(pathname: string): string {
  const match = matchErp3Route(pathname);
  if (!match) {
    return `${ERP3_MODULE_LABEL} · ${ERP3_APP_TITLE}`;
  }
  return `${match.descriptor.title} · ${ERP3_APP_TITLE}`;
}
