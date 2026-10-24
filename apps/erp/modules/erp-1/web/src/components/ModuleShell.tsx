/**
 * ERP-1 Products & Inventory — Module Layout Shell
 *
 * The common layout shell every ERP-1 screen renders inside:
 *   skip link → banner → navigation → breadcrumb → main region
 *
 * The shell owns the landmarks (`banner`, `navigation`, `main`), the browser
 * title, and the breadcrumb trail.
 *
 * @module erp1/web/components/ModuleShell
 */

import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ModuleBreadcrumbs } from './ModuleBreadcrumbs.js';
import { ModuleNav } from './ModuleNav.js';
import { ERP1_MODULE_LABEL, resolveErp1DocumentTitle } from '../route-manifest.js';

/** The ID of the main region — the target of the skip link. */
export const ERP1_MAIN_REGION_ID = 'erp1-main';

export const ModuleShell: React.FC = () => {
  const location = useLocation();
  const documentTitle = resolveErp1DocumentTitle(location.pathname);

  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  return (
    <div className="cs-erp1-shell">
      <a className="cs-erp1-skip-link" href={`#${ERP1_MAIN_REGION_ID}`}>
        Skip to main content
      </a>

      <header className="cs-erp1-banner" role="banner" aria-label={ERP1_MODULE_LABEL}>
        <p className="cs-erp1-eyebrow">ClearShift ERP · Module 1</p>
        <p className="cs-erp1-module-title">{ERP1_MODULE_LABEL}</p>
      </header>

      <div className="cs-erp1-body">
        <ModuleNav pathname={location.pathname} />

        <div className="cs-erp1-content">
          <div className="cs-erp1-breadcrumb">
            <ModuleBreadcrumbs pathname={location.pathname} />
          </div>

          <main
            id={ERP1_MAIN_REGION_ID}
            className="cs-erp1-main"
            tabIndex={-1}
            aria-label={`${ERP1_MODULE_LABEL} content`}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
};

export default ModuleShell;
