/**
 * ERP-5 HR & Employees — Module Breadcrumbs
 *
 * The breadcrumb trail is rendered by the shared `Breadcrumb` component from
 * `@cs/ui` (PLT-08) so the landmark, the ordered list and the
 * `aria-current="page"` marker are identical to every other module.
 *
 * @module erp5/web/components/ModuleBreadcrumbs
 */

import React from 'react';
import { Breadcrumb } from '@cs/ui';
import { buildErp5Breadcrumbs } from '../route-manifest.js';

export interface ModuleBreadcrumbsProps {
  readonly pathname: string;
}

export const ModuleBreadcrumbs: React.FC<ModuleBreadcrumbsProps> = ({ pathname }) => (
  <Breadcrumb items={buildErp5Breadcrumbs(pathname)} />
);

export default ModuleBreadcrumbs;
