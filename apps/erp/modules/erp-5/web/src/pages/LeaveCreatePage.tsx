/**
 * ERP-5 HR & Employees — Leave Create Route Target
 *
 * The create form is delivered by ERP5-20. This issue registers the route
 * only.
 *
 * @module erp5/web/pages/LeaveCreatePage
 */

import React from 'react';
import { ModulePlaceholderPage } from './ModulePlaceholderPage.js';

export const LeaveCreatePage: React.FC = () => (
  <ModulePlaceholderPage
    title="New leave record"
    description="Record a leave request. The end date can never precede the start date."
    ownedBy="ERP5-20"
  />
);

export default LeaveCreatePage;
