/**
 * ERP-4 Finance & Accounting — Route Manifest
 *
 * Route constants and navigation metadata for the ERP-4 web module.
 *
 * @module erp4/web/route-manifest
 */

export const ERP4_BASE_PATH = '/erp4';
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
