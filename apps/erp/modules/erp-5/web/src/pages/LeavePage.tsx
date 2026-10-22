/**
 * ERP-5 HR & Employees — Leave Records List Route Target
 *
 * The collection screen is delivered by ERP5-17, ERP5-18 and ERP5-19. This
 * issue registers the route only.
 *
 * @module erp5/web/pages/LeavePage
 */

import React from 'react';
import { ModulePlaceholderPage } from './ModulePlaceholderPage.js';

export const LeavePage: React.FC = () => (
  <ModulePlaceholderPage
    title="Leave records"
    description="Leave requests with their type, period and approval status."
    ownedBy="ERP5-17 / ERP5-18 / ERP5-19"
  />
);

export default LeavePage;
