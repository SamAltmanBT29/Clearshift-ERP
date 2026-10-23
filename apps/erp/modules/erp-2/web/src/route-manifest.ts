/**
 * ERP-2 Vendors & Purchasing — Route Manifest
 *
 * Single source of truth for the module's route table, navigation hierarchy,
 * breadcrumb trail, and browser title.
 *
 * Architecture references:
 * - ClearShift V1 Master Architecture Spec §3.1 — `/erp2/{vendors,purchase-orders}`
 * - SDS ClearShift ERP v2.0 §4.3 (FR-ERP2-01..06) & §4.9 (ERP-2 screens)
 * - Gate G1 (Sprint 1) & Issue #132 (ERP2-16)
 *
 * @module erp2/web/route-manifest
 */

/** Path prefix every ERP-2 screen lives under. */
export const ERP2_BASE_PATH = '/erp2';

/** Hub login screen (Platform owned). */
export const HUB_LOGIN_PATH = '/login';

/** Module label used in shell banner and breadcrumb trail. */
export const ERP2_MODULE_LABEL = 'Vendors & Purchasing';

/** Application name appended to browser title. */
export const ERP2_APP_TITLE = 'ClearShift ERP';

/** Navigation groups of the module, in display order. */
export type Erp2NavGroupId = 'purchasing' | 'integration';

export interface Erp2NavGroup {
  readonly id: Erp2NavGroupId;
  readonly label: string;
}

export interface Erp2RouteDescriptor {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly title: string;
  readonly group: Erp2NavGroupId | null;
}

export const ERP2_NAV_GROUPS: readonly Erp2NavGroup[] = [
  { id: 'purchasing', label: 'Purchasing' },
  { id: 'integration', label: 'Integration' },
];

/**
 * Frozen route table of the module.
 *
 * Descriptors with `group: null` represent child/detail/create/edit views that
 * are reached from the parent list screens rather than the primary sidebar navigation.
 */
export const ERP2_ROUTE_DESCRIPTORS: readonly Erp2RouteDescriptor[] = [
  {
    id: 'vendors',
    path: 'vendors',
    label: 'Vendors',
    title: 'Vendors',
    group: 'purchasing',
  },
  {
    id: 'vendors-create',
    path: 'vendors/new',
    label: 'New vendor',
    title: 'New vendor',
    group: null,
  },
  {
    id: 'vendors-detail',
    path: 'vendors/:vendorId',
    label: 'Vendor',
    title: 'Vendor',
    group: null,
  },
  {
    id: 'vendors-edit',
    path: 'vendors/:vendorId/edit',
    label: 'Edit vendor',
    title: 'Edit vendor',
    group: null,
  },
  {
    id: 'purchase-orders',
    path: 'purchase-orders',
    label: 'Purchase orders',
    title: 'Purchase orders',
    group: 'purchasing',
  },
  {
    id: 'purchase-orders-create',
    path: 'purchase-orders/new',
    label: 'New purchase order',
    title: 'New purchase order',
    group: null,
  },
  {
    id: 'purchase-orders-detail',
    path: 'purchase-orders/:purchaseOrderId',
    label: 'Purchase order',
    title: 'Purchase order',
    group: null,
  },
  {
    id: 'import-receipts',
    path: 'import-receipts',
    label: 'Import receipts',
    title: 'Import receipts',
    group: 'integration',
  },
];

/** Absolute URL path of a registered route descriptor. */
export function erp2RoutePath(descriptor: Erp2RouteDescriptor): string {
  return `${ERP2_BASE_PATH}/${descriptor.path}`;
}

/** Absolute URL path of a registered route, addressed by its descriptor id. */
export function erp2RoutePathById(id: string): string {
  const descriptor = ERP2_ROUTE_DESCRIPTORS.find((candidate) => candidate.id === id);
  if (!descriptor) {
    throw new Error(`Unknown ERP-2 route descriptor: '${id}'`);
  }
  return erp2RoutePath(descriptor);
}

/** The primary navigation entries of the module (descriptors that declare a group). */
export function erp2NavItems(): Erp2RouteDescriptor[] {
  return ERP2_ROUTE_DESCRIPTORS.filter((descriptor) => descriptor.group !== null);
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith(':');
}

/**
 * Decodes a URL path segment safely, tolerating malformed percent escapes
 * (e.g. `/erp2/vendors/100%`) so the shell never crashes on invalid user input.
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
 * Static segments always take precedence over dynamic segments so that
 * `/erp2/vendors/new` resolves cleanly to the create screen and never
 * to the parameterized `/erp2/vendors/:vendorId` route.
 */
export function matchErp2Route(
  pathname: string
): { readonly descriptor: Erp2RouteDescriptor; readonly params: Readonly<Record<string, string>> } | null {
  const pathSegments = segmentsOf(pathname);

  if (pathSegments.length === 0 || pathSegments[0] !== 'erp2') {
    return null;
  }
  const routeSegments = pathSegments.slice(1);

  let best:
    | { readonly descriptor: Erp2RouteDescriptor; readonly params: Readonly<Record<string, string>> }
    | null = null;
  let bestStaticScore = -1;

  for (const descriptor of ERP2_ROUTE_DESCRIPTORS) {
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
 * The match is segment-boundary aware:
 * e.g. `/erp2/vendors` is active for `/erp2/vendors` and `/erp2/vendors/abc`,
 * but never for an unrelated prefix like `/erp2/vendors-archive`.
 */
export function isErp2PathActive(navPath: string, pathname: string): boolean {
  if (pathname === navPath) {
    return true;
  }
  return pathname.startsWith(`${navPath}/`);
}

/** Finds the navigation item that owns the given pathname, or `null`. */
export function findErp2NavItemForPath(pathname: string): Erp2RouteDescriptor | null {
  return erp2NavItems().find((item) => isErp2PathActive(erp2RoutePath(item), pathname)) ?? null;
}

const SEGMENT_LABELS: Readonly<Record<string, string>> = {
  new: 'New',
  edit: 'Edit',
};

/**
 * Builds the breadcrumb trail for a given pathname.
 *
 * Trail format: `Vendors & Purchasing → <Resource> → <Sub-action / ID>`.
 */
export function buildErp2Breadcrumbs(
  pathname: string
): { label: string; href?: string; isCurrent?: boolean }[] {
  const trail: { label: string; href?: string; isCurrent?: boolean }[] = [
    { label: ERP2_MODULE_LABEL, href: ERP2_BASE_PATH },
  ];

  const pathSegments = segmentsOf(pathname);
  if (pathSegments.length < 2 || pathSegments[0] !== 'erp2') {
    trail[0] = { label: ERP2_MODULE_LABEL, href: ERP2_BASE_PATH, isCurrent: true };
    return trail;
  }

  const entity = findErp2NavItemForPath(pathname);
  if (!entity) {
    trail.push({ label: 'Not found', isCurrent: true });
    return trail;
  }

  const entityPath = erp2RoutePath(entity);
  trail.push({
    label: entity.label,
    ...(pathname === entityPath ? { isCurrent: true } : { href: entityPath }),
  });

  const remaining = segmentsOf(pathname).slice(2);
  remaining.forEach((segment, index) => {
    const isLast = index === remaining.length - 1;
    trail.push({
      label: SEGMENT_LABELS[segment] ?? safeDecodeSegment(segment),
      isCurrent: isLast,
    });
  });

  return trail;
}

/**
 * Resolves the document title for a pathname.
 * Format: `<Resource / Action> · ClearShift ERP`.
 */
export function resolveErp2DocumentTitle(pathname: string): string {
  const match = matchErp2Route(pathname);
  if (!match) {
    return `${ERP2_MODULE_LABEL} · ${ERP2_APP_TITLE}`;
  }
  return `${match.descriptor.title} · ${ERP2_APP_TITLE}`;
}
