/**
 * ERP-4 Finance and Accounting — Module Breadcrumbs
 *
 * Renders the breadcrumb trail using the shared UI library Breadcrumb component.
 *
 * @module erp4/web/components/ModuleBreadcrumbs
 */

import React from 'react';
import { Breadcrumb } from '@cs/ui';
import { buildErp4Breadcrumbs } from '../route-manifest.js';

export interface ModuleBreadcrumbsProps {
  readonly pathname: string;
}

export const ModuleBreadcrumbs: React.FC<ModuleBreadcrumbsProps> = ({ pathname }) => (
  <Breadcrumb items={buildErp4Breadcrumbs(pathname)} />
);

export default ModuleBreadcrumbs;
