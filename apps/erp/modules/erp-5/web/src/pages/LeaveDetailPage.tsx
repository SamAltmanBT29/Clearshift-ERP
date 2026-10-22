/**
 * ERP-5 HR & Employees — Leave Detail Route Target
 *
 * The detail view with inline edit, audit metadata and linked records is
 * delivered by ERP5-21. This issue registers the route only.
 *
 * @module erp5/web/pages/LeaveDetailPage
 */

import React from 'react';
import { ModulePlaceholderPage } from './ModulePlaceholderPage.js';

export const LeaveDetailPage: React.FC = () => (
  <ModulePlaceholderPage
    title="Leave record"
    description="One leave request with its period, status history and linked employee."
    ownedBy="ERP5-21"
  />
);

export default LeaveDetailPage;
