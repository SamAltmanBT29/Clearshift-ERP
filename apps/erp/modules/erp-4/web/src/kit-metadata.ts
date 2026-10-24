/**
 * ERP-4 Finance & Accounting — Web Migration Kit Metadata (KIT-14 / KIT-05 / ERP4-28)
 *
 * Provides module target entity definitions, human-readable labels, enum options,
 * and required target field constraints for ERP-4 entities consumed by web pages
 * and the shared MigrationKitWizard.
 *
 * @module erp4/web/kit-metadata
 */

import type { ModuleKitMetadata } from '@cs/kit';
import {
  erp4WebKitMetadata,
  erp4TargetEntities,
  erp4AccountsTargetFields,
  erp4OpeningBalancesTargetFields,
  erp4JournalEntriesTargetFields,
  erp4JournalLinesTargetFields,
  ACCOUNT_TYPE_TRANSLATION_MAP,
  CURRENCY_CODE_TRANSLATION_MAP,
  PERIOD_STATUS_TRANSLATION_MAP,
  ERP4_DEFAULT_MAPPING_TEMPLATES,
  ERP4_CANONICAL_MAPPING_TEMPLATE,
} from '../../src/migration/mapping-config.js';

export {
  erp4WebKitMetadata,
  erp4TargetEntities,
  erp4AccountsTargetFields,
  erp4OpeningBalancesTargetFields,
  erp4JournalEntriesTargetFields,
  erp4JournalLinesTargetFields,
  ACCOUNT_TYPE_TRANSLATION_MAP,
  CURRENCY_CODE_TRANSLATION_MAP,
  PERIOD_STATUS_TRANSLATION_MAP,
  ERP4_DEFAULT_MAPPING_TEMPLATES,
  ERP4_CANONICAL_MAPPING_TEMPLATE,
};
