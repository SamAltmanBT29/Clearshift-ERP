/**
 * ERP-5 HR & Employees — Employee Create Route Target
 *
 * The create form is delivered by ERP5-20 (React Hook Form, client-side Zod
 * validation and server error mapping). This issue registers the route only.
 *
 * @module erp5/web/pages/EmployeeCreatePage
 */

import React from 'react';
import { ModulePlaceholderPage } from './ModulePlaceholderPage.js';

export const EmployeeCreatePage: React.FC = () => (
  <ModulePlaceholderPage
    title="New employee"
    description="Create a staff record. Employee numbers are unique and the join date can never precede the birth date."
    ownedBy="ERP5-20"
  />
);

export default EmployeeCreatePage;
