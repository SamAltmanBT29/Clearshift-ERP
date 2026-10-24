/**
 * ERP-4 Finance and Accounting — Route Manifest
 *
 * Single source of truth for all routes, navigation hierarchies, browser titles,
 * and breadcrumb trails in ERP-4.
 *
 * Architecture references:
 * - ClearShift V1 Master Architecture Spec §3.1 & §6.1
 * - SDS ClearShift ERP v2.0 §4.4 & §4.9
 * - Gate G1 (Sprint 1) & Issue #172 (ERP4-16)
 *
 * @module erp4/web/route-manifest
 */

/** Path prefix every ERP-4 screen lives under. */
export const ERP4_BASE_PATH = '/erp4';

/** Hub login screen (Platform owned). */
export const HUB_LOGIN_PATH = '/login';

export const ERP4_ROUTES = {
  root: ERP4_BASE_PATH,
  accounts: `${ERP4_BASE_PATH}/accounts`,
  accountsCreate: `${ERP4_BASE_PATH}/accounts/new`,
  journalEntries: `${ERP4_BASE_PATH}/journal-entries`,
  journalEntriesCreate: `${ERP4_BASE_PATH}/journal-entries/new`,
  journalEntryDetail: (id: string) => `${ERP4_BASE_PATH}/journal-entries/${id}`,
  trialBalance: `${ERP4_BASE_PATH}/trial-balance`,
  migrationCleaning: `${ERP4_BASE_PATH}/migration/cleaning`,
  migrationProfiling: `${ERP4_BASE_PATH}/migration/profiling`,
  migrationMapping: `${ERP4_BASE_PATH}/migration/mapping`,
} as const;

/** Module label used in shell banner and breadcrumb trail. */
export const ERP4_MODULE_LABEL = 'Finance & Accounting';

/** Application name appended to browser title. */
export const ERP4_APP_TITLE = 'ClearShift ERP';

/** Navigation groups of the module, in display order. */
export type Erp4NavGroupId = 'general-ledger' | 'reports' | 'migration';

export interface Erp4NavGroup {
  readonly id: Erp4NavGroupId;
  readonly label: string;
}

export interface Erp4RouteDescriptor {
  readonly id: string;
  readonly path: string;
  readonly label: string;
  readonly title: string;
  readonly group: Erp4NavGroupId | null;
}

export const ERP4_NAV_GROUPS: readonly Erp4NavGroup[] = [
  { id: 'general-ledger', label: 'General Ledger' },
  { id: 'reports', label: 'Financial Reports' },
  { id: 'migration', label: 'Migration & Quality' },
];

/**
 * Frozen route table of the module.
 *
 * Descriptors with `group: null` represent child/detail/create/edit views that
 * are reached from the parent list screens rather than the primary sidebar navigation.
 */
export const ERP4_ROUTE_DESCRIPTORS: readonly Erp4RouteDescriptor[] = [
  {
    id: 'accounts',
    path: 'accounts',
    label: 'Chart of Accounts',
    title: 'Chart of Accounts',
    group: 'general-ledger',
  },
  {
    id: 'accounts-create',
    path: 'accounts/new',
    label: 'New Account',
    title: 'New Account',
    group: null,
  },
  {
    id: 'accounts-detail',
    path: 'accounts/:accountId',
    label: 'Account Details',
    title: 'Account Details',
    group: null,
  },
  {
    id: 'accounts-edit',
    path: 'accounts/:accountId/edit',
    label: 'Edit Account',
    title: 'Edit Account',
    group: null,
  },
  {
    id: 'journal-entries',
    path: 'journal-entries',
    label: 'Journal Entries',
    title: 'Journal Entries',
    group: 'general-ledger',
  },
  {
    id: 'journal-entries-create',
    path: 'journal-entries/new',
    label: 'New Journal Entry',
    title: 'New Journal Entry',
    group: null,
  },
  {
    id: 'journal-entries-detail',
    path: 'journal-entries/:entryId',
    label: 'Journal Entry Details',
    title: 'Journal Entry Details',
    group: null,
  },
  {
    id: 'journal-entries-edit',
    path: 'journal-entries/:entryId/edit',
    label: 'Edit Journal Entry',
    title: 'Edit Journal Entry',
    group: null,
  },
  {
    id: 'trial-balance',
    path: 'trial-balance',
    label: 'Trial Balance',
    title: 'Trial Balance',
    group: 'reports',
  },
  {
    id: 'migration-profile',
    path: 'migration/profile',
    label: 'Data Health & Profiling',
    title: 'Data Health & Profiling',
    group: 'migration',
  },
  {
    id: 'migration-clean',
    path: 'migration/clean',
    label: 'Data Cleaning Review',
    title: 'Data Cleaning Review',
    group: 'migration',
  },
  {
    id: 'migration-mapping',
    path: 'migration/mapping',
    label: 'Mapping Configuration',
    title: 'Mapping Configuration',
    group: 'migration',
  },
];

/** Absolute URL path of a registered route descriptor. */
export function erp4RoutePath(descriptor: Erp4RouteDescriptor): string {
  return `${ERP4_BASE_PATH}/${descriptor.path}`;
}

/** Absolute URL path of a registered route, addressed by its descriptor id. */
export function erp4RoutePathById(id: string): string {
  const descriptor = ERP4_ROUTE_DESCRIPTORS.find((candidate) => candidate.id === id);
  if (!descriptor) {
    throw new Error(`Unknown ERP-4 route descriptor: '${id}'`);
  }
  return erp4RoutePath(descriptor);
}

/** The primary navigation entries of the module (descriptors that declare a group). */
export function erp4NavItems(): Erp4RouteDescriptor[] {
  return ERP4_ROUTE_DESCRIPTORS.filter((descriptor) => descriptor.group !== null);
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith(':');
}

/**
 * Decodes a URL path segment safely, tolerating malformed percent escapes
 * (e.g. `/erp4/accounts/100%`) so the shell never crashes on invalid user input.
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
 * `/erp4/accounts/new` resolves cleanly to the create screen and never
 * to the parameterized `/erp4/accounts/:accountId` route.
 */
export function matchErp4Route(
  pathname: string
): { readonly descriptor: Erp4RouteDescriptor; readonly params: Readonly<Record<string, string>> } | null {
  const pathSegments = segmentsOf(pathname);

  if (pathSegments.length === 0 || pathSegments[0] !== 'erp4') {
    return null;
  }
  const routeSegments = pathSegments.slice(1);

  let best:
    | { readonly descriptor: Erp4RouteDescriptor; readonly params: Readonly<Record<string, string>> }
    | null = null;
  let bestStaticScore = -1;

  for (const descriptor of ERP4_ROUTE_DESCRIPTORS) {
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
 * e.g. `/erp4/accounts` is active for `/erp4/accounts` and `/erp4/accounts/abc`,
 * but never for an unrelated prefix like `/erp4/accounts-archive`.
 */
export function isErp4PathActive(navPath: string, pathname: string): boolean {
  if (pathname === navPath) {
    return true;
  }
  return pathname.startsWith(`${navPath}/`);
}

/** Finds the navigation item that owns the given pathname, or `null`. */
export function findErp4NavItemForPath(pathname: string): Erp4RouteDescriptor | null {
  return erp4NavItems().find((item) => isErp4PathActive(erp4RoutePath(item), pathname)) ?? null;
}

const SEGMENT_LABELS: Readonly<Record<string, string>> = {
  new: 'New',
  edit: 'Edit',
};

/**
 * Builds the breadcrumb trail for a given pathname.
 *
 * Trail format: `Finance & Accounting → <Resource> → <Sub-action / ID>`.
 */
export function buildErp4Breadcrumbs(
  pathname: string
): { label: string; href?: string; isCurrent?: boolean }[] {
  const trail: { label: string; href?: string; isCurrent?: boolean }[] = [
    { label: ERP4_MODULE_LABEL, href: ERP4_BASE_PATH },
  ];

  const pathSegments = segmentsOf(pathname);
  if (pathSegments.length < 2 || pathSegments[0] !== 'erp4') {
    trail[0] = { label: ERP4_MODULE_LABEL, href: ERP4_BASE_PATH, isCurrent: true };
    return trail;
  }

  const entity = findErp4NavItemForPath(pathname);
  if (!entity) {
    trail.push({ label: 'Not found', isCurrent: true });
    return trail;
  }

  const entityPath = erp4RoutePath(entity);
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
export function resolveErp4DocumentTitle(pathname: string): string {
  const match = matchErp4Route(pathname);
  if (!match) {
    return `${ERP4_MODULE_LABEL} · ${ERP4_APP_TITLE}`;
  }
  return `${match.descriptor.title} · ${ERP4_APP_TITLE}`;
}
