/**
 * ERP-1 Products & Inventory — Module Breadcrumbs
 *
 * Uses the shared `Breadcrumb` component from `@cs/ui` (PLT-08) so the
 * landmark, the ordered list, and the `aria-current="page"` marker are
 * consistent across modules.
 *
 * @module erp1/web/components/ModuleBreadcrumbs
 */

import React from 'react';
import { Breadcrumb } from '@cs/ui';
import { buildErp1Breadcrumbs } from '../route-manifest.js';

export interface ModuleBreadcrumbsProps {
  readonly pathname: string;
}

export const ModuleBreadcrumbs: React.FC<ModuleBreadcrumbsProps> = ({ pathname }) => (
  <Breadcrumb items={buildErp1Breadcrumbs(pathname)} />
);

export default ModuleBreadcrumbs;
