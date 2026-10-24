/**
 * ERP-5 HR & Employees — Module Layout Shell
 *
 * The common layout every ERP-5 screen renders inside:
 *
 *   skip link → banner → navigation → breadcrumb → main region
 *
 * The shell owns the landmarks (`banner`, `navigation`, `main`), the browser
 * title and the breadcrumb trail. It deliberately does **not** own the page
 * heading — the page itself renders the single `h1` through the shared
 * `PageTitle` component.
 *
 * @module erp5/web/components/ModuleShell
 */

import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ModuleBreadcrumbs } from './ModuleBreadcrumbs.js';
import { ModuleNav } from './ModuleNav.js';
import { ToastProvider } from '../hooks/useToast.js';
import { ERP5_MODULE_LABEL, resolveErp5DocumentTitle } from '../route-manifest.js';

/** The id of the main region — the target of the skip link. */
export const ERP5_MAIN_REGION_ID = 'erp5-main';

export const ModuleShell: React.FC = () => {
  const location = useLocation();
  const documentTitle = resolveErp5DocumentTitle(location.pathname);

  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  return (
    <ToastProvider>
      <div className="cs-erp5-shell">
      <a className="cs-erp5-skip-link" href={`#${ERP5_MAIN_REGION_ID}`}>
        Skip to main content
      </a>

      {/*
        The banner is named so that it stays distinguishable from the
        `<header>` element the shared `PageTitle` renders inside the main
        region. Both are valid HTML — only the module banner is a banner
        landmark — but an explicit name keeps the landmark unambiguous for
        assistive technology and for the accessibility assertions.
      */}
      <header className="cs-erp5-banner" role="banner" aria-label={ERP5_MODULE_LABEL}>
        <p className="cs-erp5-eyebrow">ClearShift ERP · Module 5</p>
        <p className="cs-erp5-module-title">{ERP5_MODULE_LABEL}</p>
      </header>

      <div className="cs-erp5-body">
        <ModuleNav pathname={location.pathname} />

        <div className="cs-erp5-content">
          <div className="cs-erp5-breadcrumb">
            <ModuleBreadcrumbs pathname={location.pathname} />
          </div>

          <main
            id={ERP5_MAIN_REGION_ID}
            className="cs-erp5-main"
            tabIndex={-1}
            aria-label={`${ERP5_MODULE_LABEL} content`}
          >
            <Outlet />
          </main>
        </div>
      </div>
      </div>
    </ToastProvider>
  );
};

export default ModuleShell;
