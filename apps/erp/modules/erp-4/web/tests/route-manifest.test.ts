import { describe, it, expect } from 'vitest';
import {
  ERP4_BASE_PATH,
  HUB_LOGIN_PATH,
  ERP4_MODULE_LABEL,
  ERP4_APP_TITLE,
  ERP4_NAV_GROUPS,
  ERP4_ROUTE_DESCRIPTORS,
  erp4RoutePath,
  erp4RoutePathById,
  erp4NavItems,
  matchErp4Route,
  isErp4PathActive,
  findErp4NavItemForPath,
  buildErp4Breadcrumbs,
  resolveErp4DocumentTitle,
} from '../src/route-manifest.js';

describe('ERP-4 Route Manifest', () => {
  it('defines stable module base and login paths', () => {
    expect(ERP4_BASE_PATH).toBe('/erp4');
    expect(HUB_LOGIN_PATH).toBe('/login');
    expect(ERP4_MODULE_LABEL).toBe('Finance & Accounting');
    expect(ERP4_APP_TITLE).toBe('ClearShift ERP');
  });

  it('defines all required navigation groups in order', () => {
    expect(ERP4_NAV_GROUPS.map((g) => g.id)).toEqual([
      'general-ledger',
      'reports',
      'migration',
    ]);
  });

  it('registers all primary entity and report routes', () => {
    const ids = ERP4_ROUTE_DESCRIPTORS.map((d) => d.id);
    expect(ids).toContain('accounts');
    expect(ids).toContain('accounts-create');
    expect(ids).toContain('accounts-detail');
    expect(ids).toContain('accounts-edit');
    expect(ids).toContain('journal-entries');
    expect(ids).toContain('journal-entries-create');
    expect(ids).toContain('journal-entries-detail');
    expect(ids).toContain('trial-balance');
    expect(ids).toContain('migration-profile');
    expect(ids).toContain('migration-clean');
    expect(ids).toContain('migration-mapping');
  });

  it('constructs absolute route paths correctly', () => {
    const accountsDescriptor = ERP4_ROUTE_DESCRIPTORS.find((d) => d.id === 'accounts')!;
    expect(erp4RoutePath(accountsDescriptor)).toBe('/erp4/accounts');
    expect(erp4RoutePathById('journal-entries')).toBe('/erp4/journal-entries');
    expect(erp4RoutePathById('trial-balance')).toBe('/erp4/trial-balance');
  });

  it('throws when resolving unknown route id', () => {
    expect(() => erp4RoutePathById('unknown-route')).toThrow(
      "Unknown ERP-4 route descriptor: 'unknown-route'"
    );
  });

  it('filters primary navigation items with declared groups', () => {
    const navItems = erp4NavItems();
    for (const item of navItems) {
      expect(item.group).not.toBeNull();
    }
    expect(navItems.some((item) => item.id === 'accounts')).toBe(true);
    expect(navItems.some((item) => item.id === 'journal-entries')).toBe(true);
    expect(navItems.some((item) => item.id === 'accounts-create')).toBe(false);
  });

  it('matches static routes cleanly', () => {
    const match = matchErp4Route('/erp4/accounts');
    expect(match).not.toBeNull();
    expect(match?.descriptor.id).toBe('accounts');
    expect(match?.params).toEqual({});
  });

  it('matches dynamic parameterized routes and extracts params', () => {
    const match = matchErp4Route('/erp4/accounts/acc-101');
    expect(match).not.toBeNull();
    expect(match?.descriptor.id).toBe('accounts-detail');
    expect(match?.params).toEqual({ accountId: 'acc-101' });
  });

  it('prefers static routes over dynamic ones (/accounts/new vs /accounts/:accountId)', () => {
    const match = matchErp4Route('/erp4/accounts/new');
    expect(match).not.toBeNull();
    expect(match?.descriptor.id).toBe('accounts-create');
  });

  it('safely decodes percent escapes without crashing on malformed input', () => {
    const match = matchErp4Route('/erp4/accounts/acc-100%');
    expect(match).not.toBeNull();
    expect(match?.params.accountId).toBe('acc-100%');
  });

  it('returns null when matching external paths', () => {
    expect(matchErp4Route('/erp2/vendors')).toBeNull();
    expect(matchErp4Route('/')).toBeNull();
  });

  it('evaluates active paths with segment boundary awareness', () => {
    expect(isErp4PathActive('/erp4/accounts', '/erp4/accounts')).toBe(true);
    expect(isErp4PathActive('/erp4/accounts', '/erp4/accounts/acc-123')).toBe(true);
    expect(isErp4PathActive('/erp4/accounts', '/erp4/accounts-archive')).toBe(false);
  });

  it('finds navigation item that owns pathname', () => {
    const navItem = findErp4NavItemForPath('/erp4/accounts/acc-123');
    expect(navItem?.id).toBe('accounts');

    const unknown = findErp4NavItemForPath('/erp4/non-existent-subpath');
    expect(unknown).toBeNull();
  });

  it('builds breadcrumbs hierarchy for routes', () => {
    const rootCrumbs = buildErp4Breadcrumbs('/erp4');
    expect(rootCrumbs).toHaveLength(1);
    expect(rootCrumbs[0]?.label).toBe('Finance & Accounting');
    expect(rootCrumbs[0]?.isCurrent).toBe(true);

    const accountsCrumbs = buildErp4Breadcrumbs('/erp4/accounts');
    expect(accountsCrumbs).toHaveLength(2);
    expect(accountsCrumbs[1]?.label).toBe('Chart of Accounts');
    expect(accountsCrumbs[1]?.isCurrent).toBe(true);

    const newAccountCrumbs = buildErp4Breadcrumbs('/erp4/accounts/new');
    expect(newAccountCrumbs).toHaveLength(3);
    expect(newAccountCrumbs[1]?.label).toBe('Chart of Accounts');
    expect(newAccountCrumbs[1]?.href).toBe('/erp4/accounts');
    expect(newAccountCrumbs[2]?.label).toBe('New');
    expect(newAccountCrumbs[2]?.isCurrent).toBe(true);
  });

  it('resolves correct document titles', () => {
    expect(resolveErp4DocumentTitle('/erp4/accounts')).toBe(
      'Chart of Accounts · ClearShift ERP'
    );
    expect(resolveErp4DocumentTitle('/erp4/trial-balance')).toBe(
      'Trial Balance · ClearShift ERP'
    );
    expect(resolveErp4DocumentTitle('/erp4/unknown')).toBe(
      'Finance & Accounting · ClearShift ERP'
    );
  });
});
