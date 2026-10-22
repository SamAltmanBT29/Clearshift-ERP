/**
 * ERP-5 HR & Employees — Employee Detail Route Target
 *
 * The detail view with inline edit, audit metadata and linked records is
 * delivered by ERP5-21. This issue registers the route only.
 *
 * @module erp5/web/pages/EmployeeDetailPage
 */

import React from 'react';
import { ModulePlaceholderPage } from './ModulePlaceholderPage.js';

export const EmployeeDetailPage: React.FC = () => (
  <ModulePlaceholderPage
    title="Employee"
    description="One staff record with its attributes, audit metadata and linked records."
    ownedBy="ERP5-21"
  />
);

export default EmployeeDetailPage;
