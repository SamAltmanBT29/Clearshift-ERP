/**
 * ERP-5 HR & Employees — Payroll Totals Route Target
 *
 * The read-only report screen is delivered by ERP5-17. The screen shows
 * department and month aggregates only — it never exposes employee rows
 * (FR-ERP5-06, BR-ERP5-02).
 *
 * @module erp5/web/pages/PayrollTotalsPage
 */

import React from 'react';
import { ModulePlaceholderPage } from './ModulePlaceholderPage.js';

export const PayrollTotalsPage: React.FC = () => (
  <ModulePlaceholderPage
    title="Payroll totals"
    description="Department and month payroll aggregates. Never employee rows."
    ownedBy="ERP5-17"
  />
);

export default PayrollTotalsPage;
