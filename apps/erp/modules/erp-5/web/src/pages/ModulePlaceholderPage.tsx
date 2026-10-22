/**
 * ERP-5 HR & Employees — Module Placeholder Page
 *
 * A route target for a screen that is delivered by a later issue of the
 * frontend workstream:
 *
 *   ERP5-17 → the collection tables (employees, departments, leave)
 *   ERP5-20 → the create forms
 *   ERP5-21 → the detail views
 *
 * The placeholder is deliberately thin: it proves the route resolves inside
 * the shell and that the screen is reachable, without pretending to be the
 * finished screen. It uses the shared `PageTitle` component so the heading
 * level, the spacing and the typography are already the production ones.
 *
 * @module erp5/web/pages/ModulePlaceholderPage
 */

import React from 'react';
import { PageTitle } from '@cs/ui';

export interface ModulePlaceholderPageProps {
  readonly title: string;
  readonly description: string;
  /** The issue that owns the finished screen. */
  readonly ownedBy: string;
}

export const ModulePlaceholderPage: React.FC<ModulePlaceholderPageProps> = ({
  title,
  description,
  ownedBy,
}) => (
  <>
    <PageTitle title={title} subtitle={description} />
    <section className="cs-erp5-placeholder" aria-label={`${title} screen`}>
      <p className="cs-erp5-placeholder-text">
        This screen is registered by the ERP-5 route table. The finished screen is delivered
        by <strong>{ownedBy}</strong>; the route, the navigation entry, the breadcrumb and the
        browser title are already live.
      </p>
    </section>
  </>
);

export default ModulePlaceholderPage;
