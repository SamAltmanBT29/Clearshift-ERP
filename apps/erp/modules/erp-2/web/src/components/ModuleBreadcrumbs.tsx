/**
 * ERP-2 Vendors & Purchasing — Module Breadcrumbs
 *
 * Renders the breadcrumb trail using the shared UI library Breadcrumb component.
 *
 * @module erp2/web/components/ModuleBreadcrumbs
 */

import React from 'react';
import { Breadcrumb } from '@cs/ui';
import { buildErp2Breadcrumbs } from '../route-manifest.js';

export interface ModuleBreadcrumbsProps {
  readonly pathname: string;
}

export const ModuleBreadcrumbs: React.FC<ModuleBreadcrumbsProps> = ({ pathname }) => (
  <Breadcrumb items={buildErp2Breadcrumbs(pathname)} />
);

export default ModuleBreadcrumbs;
