/**
 * ERP-5 HR & Employees — Form Page Layout
 *
 * The scaffold every create, edit and detail screen of the module uses: a
 * way back to the list the screen belongs to, and the heading of the screen.
 *
 * The way back is not decoration — it is the **list context** of the screen.
 * Every form and every detail view of the module carries one, so an operator
 * never loses the place a record came from.
 *
 * @module erp5/web/components/FormPageLayout
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { PageTitle } from '@cs/ui';

export interface FormPageLayoutProps {
  readonly title: string;
  readonly description: string;
  /** The route of the list this screen belongs to. */
  readonly backTo: string;
  /** The label of the link back, e.g. "Back to the employee list". */
  readonly backLabel: string;
  readonly children: React.ReactNode;
}

export const FormPageLayout: React.FC<FormPageLayoutProps> = ({
  title,
  description,
  backTo,
  backLabel,
  children,
}) => (
  <div className="cs-erp5-form-page">
    <Link className="cs-erp5-back-link" to={backTo}>
      <span aria-hidden="true">←</span> {backLabel}
    </Link>
    <PageTitle title={title} subtitle={description} />
    {children}
  </div>
);

export default FormPageLayout;
