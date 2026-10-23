/**
 * ERP-3 Sales Orders and Invoices — Module Layout Shell
 *
 * The common layout every ERP-3 screen renders inside:
 *
 *   skip link → banner → navigation → breadcrumb → main region
 *
 * The shell owns the landmarks (`banner`, `navigation`, `main`), the browser
 * title and the breadcrumb trail.
 *
 * @module erp3/web/components/ModuleShell
 */

import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ModuleBreadcrumbs } from './ModuleBreadcrumbs.js';
import { ModuleNav } from './ModuleNav.js';
import { ERP3_MODULE_LABEL, resolveErp3DocumentTitle } from '../route-manifest.js';

/** The id of the main region — the target of the skip link. */
export const ERP3_MAIN_REGION_ID = 'erp3-main';

export const ModuleShell: React.FC = () => {
  const location = useLocation();
  const documentTitle = resolveErp3DocumentTitle(location.pathname);

  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  return (
    <div className="cs-erp3-shell">
      <a className="cs-erp3-skip-link" href={`#${ERP3_MAIN_REGION_ID}`}>
        Skip to main content
      </a>

      <header className="cs-erp3-banner" role="banner" aria-label={ERP3_MODULE_LABEL}>
        <p className="cs-erp3-eyebrow">ClearShift ERP · Module 3</p>
        <p className="cs-erp3-module-title">{ERP3_MODULE_LABEL}</p>
      </header>

      <div className="cs-erp3-body">
        <ModuleNav pathname={location.pathname} />

        <div className="cs-erp3-content">
          <div className="cs-erp3-breadcrumb">
            <ModuleBreadcrumbs pathname={location.pathname} />
          </div>

          <main
            id={ERP3_MAIN_REGION_ID}
            className="cs-erp3-main"
            tabIndex={-1}
            aria-label={`${ERP3_MODULE_LABEL} content`}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
};

export default ModuleShell;
