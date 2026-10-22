/**
 * ERP-5 HR & Employees — Department Create Route Target
 *
 * The create form is delivered by ERP5-20. This issue registers the route
 * only.
 *
 * @module erp5/web/pages/DepartmentCreatePage
 */

import React from 'react';
import { ModulePlaceholderPage } from './ModulePlaceholderPage.js';

export const DepartmentCreatePage: React.FC = () => (
  <ModulePlaceholderPage
    title="New department"
    description="Create a department. A department may reference an optional parent department."
    ownedBy="ERP5-20"
  />
);

export default DepartmentCreatePage;
