/**
 * ERP-5 HR & Employees — Department Detail Route Target
 *
 * The detail view with inline edit, audit metadata and linked records is
 * delivered by ERP5-21. This issue registers the route only.
 *
 * @module erp5/web/pages/DepartmentDetailPage
 */

import React from 'react';
import { ModulePlaceholderPage } from './ModulePlaceholderPage.js';

export const DepartmentDetailPage: React.FC = () => (
  <ModulePlaceholderPage
    title="Department"
    description="One department with its parent reference, headcount and linked records."
    ownedBy="ERP5-21"
  />
);

export default DepartmentDetailPage;
