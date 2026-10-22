/**
 * ERP-5 HR & Employees — Identity Users Route Target
 *
 * The read-only projection of the Hub Identity accounts is delivered by
 * ERP5-17. The screen is read-only by design: the Hub owns credentials and
 * roles, and the projection carries no password, hash or token field
 * (Master Architecture Spec C3).
 *
 * @module erp5/web/pages/IdentityUsersPage
 */

import React from 'react';
import { ModulePlaceholderPage } from './ModulePlaceholderPage.js';

export const IdentityUsersPage: React.FC = () => (
  <ModulePlaceholderPage
    title="Identity users"
    description="A read-only projection of the Hub Identity accounts — usernames, roles and status."
    ownedBy="ERP5-17"
  />
);

export default IdentityUsersPage;
