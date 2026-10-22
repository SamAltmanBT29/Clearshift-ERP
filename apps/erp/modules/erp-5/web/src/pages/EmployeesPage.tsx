/**
 * ERP-5 HR & Employees — Employees List Route Target
 *
 * The collection screen is delivered by ERP5-17 (main paginated data table),
 * ERP5-18 (search, filters and sorting) and ERP5-19 (loading, empty, error
 * and access-denied states). This issue registers the route only.
 *
 * @module erp5/web/pages/EmployeesPage
 */

import React from 'react';
import { ModulePlaceholderPage } from './ModulePlaceholderPage.js';

export const EmployeesPage: React.FC = () => (
  <ModulePlaceholderPage
    title="Employees"
    description="Staff records with masked salary values, department assignment and job titles."
    ownedBy="ERP5-17 / ERP5-18 / ERP5-19"
  />
);

export default EmployeesPage;
