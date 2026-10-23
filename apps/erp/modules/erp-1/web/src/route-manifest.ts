/**
 * ERP-1 Products & Inventory — Route Manifest
 *
 * The single source of truth for the module's route table. The navigation
 * hierarchy, breadcrumb trail, document title, and React Router route objects
 * are derived from this manifest.
 *
 * Architecture reference:
 *   - ClearShift V1 Master Architecture Spec §3.1 — `/erp1/{products,categories,stock,duplicates,import}`
 *   - ClearShift V1 Master Architecture Spec §6.1 — slot 16 target path `web/routes.tsx`
 *   - SDS ClearShift ERP v2.0 §4.2, §4.7 — ERP-1 screens
 *
 * @module erp1/web/route-manifest
 */

/** The path prefix every ERP-1 screen lives under. */
export const ERP1_BASE_PATH = '/erp1';

/** The Hub login screen (Master Architecture Spec §3.1 — owner `platform`). */
export const HUB_LOGIN_PATH = '/login';

/** The module label used in the shell banner and in the breadcrumb trail. */
export const ERP1_MODULE_LABEL = 'Products & Inventory';

/** The application name appended to every browser title. */
export const ERP1_APP_TITLE = 'ClearShift ERP';

/** The navigation groups of the module, in display order. */
export type Erp1NavGroupId = 'catalog' | 'inventory' | 'migration';

export interface Erp1NavGroup {
  readonly id: Erp1NavGroupId;
  readonly label: string;
}

export interface Erp1RouteDescriptor {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly title: string;
  readonly group: Erp1NavGroupId | null;
}

export const ERP1_NAV_GROUPS: readonly Erp1NavGroup[] = [
  { id: 'catalog', label: 'Catalog' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'migration', label: 'Migration' },
];

/**
 * The frozen route table of ERP-1.
 */
export const ERP1_ROUTE_DESCRIPTORS: readonly Erp1RouteDescriptor[] = [
  {
    id: 'products',
    path: 'products',
    label: 'Products',
    title: 'Products',
    group: 'catalog',
  },
  {
    id: 'products-create',
    path: 'products/new',
    label: 'New product',
    title: 'New product',
    group: null,
  },
  {
    id: 'products-detail',
    path: 'products/:productId',
    label: 'Product detail',
    title: 'Product detail',
    group: null,
  },
  {
    id: 'products-edit',
    path: 'products/:productId/edit',
    label: 'Edit product',
    title: 'Edit product',
    group: null,
  },
  {
    id: 'categories',
    path: 'categories',
    label: 'Categories',
    title: 'Categories',
    group: 'catalog',
  },
  {
    id: 'stock',
    path: 'stock',
    label: 'Stock levels',
    title: 'Stock levels',
    group: 'inventory',
  },
  {
    id: 'duplicates',
    path: 'duplicates',
    label: 'Duplicate candidates',
    title: 'Duplicate candidates',
    group: 'migration',
  },
  {
    id: 'import',
    path: 'import',
    label: 'Migration wizard',
    title: 'Migration wizard',
    group: 'migration',
  },
  {
    id: 'rejections',
    path: 'rejections',
    label: 'Rejection review',
    title: 'Rejection review',
    group: null,
  },
];

/** All routes that appear in the primary navigation hierarchy. */
export function erp1NavItems(): Erp1RouteDescriptor[] {
  return ERP1_ROUTE_DESCRIPTORS.filter((item) => item.group !== null);
}

/** Computes the absolute URL path of a route descriptor. */
export function erp1RoutePath(descriptor: Erp1RouteDescriptor): string {
  return `${ERP1_BASE_PATH}/${descriptor.path}`;
}

/** Computes the absolute URL path of a route by descriptor ID. */
export function erp1RoutePathById(id: string): string {
  const descriptor = ERP1_ROUTE_DESCRIPTORS.find((d) => d.id === id);
  if (!descriptor) {
    throw new Error(`Unknown ERP-1 route descriptor ID: '${id}'`);
  }
  return erp1RoutePath(descriptor);
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith(':');
}

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Matches a pathname against the route table.
 * Static segments always take precedence over dynamic segments.
 */
export function matchErp1Route(
  pathname: string
): { readonly descriptor: Erp1RouteDescriptor; readonly params: Readonly<Record<string, string>> } | null {
  const pathSegments = segmentsOf(pathname);

  if (pathSegments.length === 0 || pathSegments[0] !== 'erp1') {
    return null;
  }
  const routeSegments = pathSegments.slice(1);

  let best:
    | { readonly descriptor: Erp1RouteDescriptor; readonly params: Readonly<Record<string, string>> }
    | null = null;
  let bestStaticScore = -1;

  for (const descriptor of ERP1_ROUTE_DESCRIPTORS) {
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
 * Checks whether `pathname` belongs to the navigation entry at `navPath`.
 */
export function isErp1PathActive(navPath: string, pathname: string): boolean {
  if (pathname === navPath) {
    return true;
  }
  return pathname.startsWith(`${navPath}/`);
}

/** Finds the navigation entry owning `pathname`. */
export function findErp1NavItemForPath(pathname: string): Erp1RouteDescriptor | null {
  return (
    erp1NavItems().find((item) => isErp1PathActive(erp1RoutePath(item), pathname)) ?? null
  );
}

const SEGMENT_LABELS: Readonly<Record<string, string>> = {
  new: 'New',
  edit: 'Edit',
};

/**
 * Builds the breadcrumb trail for a given pathname.
 */
export function buildErp1Breadcrumbs(
  pathname: string
): { label: string; href?: string; isCurrent?: boolean }[] {
  const trail: { label: string; href?: string; isCurrent?: boolean }[] = [
    { label: ERP1_MODULE_LABEL, href: ERP1_BASE_PATH },
  ];

  const pathSegments = segmentsOf(pathname);
  if (pathSegments.length < 2 || pathSegments[0] !== 'erp1') {
    trail[0] = { label: ERP1_MODULE_LABEL, href: ERP1_BASE_PATH, isCurrent: true };
    return trail;
  }

  const entity = findErp1NavItemForPath(pathname);
  if (!entity) {
    trail.push({ label: 'Not found', isCurrent: true });
    return trail;
  }

  const entityPath = erp1RoutePath(entity);
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
 * Resolves the document title for a given pathname.
 */
export function resolveErp1DocumentTitle(pathname: string): string {
  const match = matchErp1Route(pathname);
  if (!match) {
    return `${ERP1_MODULE_LABEL} · ${ERP1_APP_TITLE}`;
  }
  return `${match.descriptor.title} · ${ERP1_APP_TITLE}`;
}
