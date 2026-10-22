/**
 * ERP-5 HR & Employees — Departments List Route Target
 *
 * The collection screen is delivered by ERP5-17, ERP5-18 and ERP5-19. This
 * issue registers the route only.
 *
 * @module erp5/web/pages/DepartmentsPage
 */

import React from 'react';
import { ModulePlaceholderPage } from './ModulePlaceholderPage.js';

export const DepartmentsPage: React.FC = () => (
  <ModulePlaceholderPage
    title="Departments"
    description="The department hierarchy that every employee record and every payroll aggregate references."
    ownedBy="ERP5-17 / ERP5-18 / ERP5-19"
  />
);

export default DepartmentsPage;
