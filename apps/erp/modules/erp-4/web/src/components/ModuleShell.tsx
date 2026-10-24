/**
 * ERP-4 Finance and Accounting — Module Layout Shell
 *
 * Common layout shell wrapping every screen in the module:
 *   skip link → banner → navigation → breadcrumbs → main region
 *
 * Implements accessible ARIA landmarks and dynamic browser document title sync.
 *
 * @module erp4/web/components/ModuleShell
 */

import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ModuleBreadcrumbs } from './ModuleBreadcrumbs.js';
import { ModuleNav } from './ModuleNav.js';
import { ERP4_MODULE_LABEL, resolveErp4DocumentTitle } from '../route-manifest.js';

/** Identifier of the main region — target of the keyboard skip link. */
export const ERP4_MAIN_REGION_ID = 'erp4-main';

export const ModuleShell: React.FC = () => {
  const location = useLocation();
  const documentTitle = resolveErp4DocumentTitle(location.pathname);

  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  return (
    <div className="cs-erp4-shell">
      {/* Keyboard accessible skip link (first focusable item) */}
      <a className="cs-erp4-skip-link" href={`#${ERP4_MAIN_REGION_ID}`}>
        Skip to main content
      </a>

      {/* Module banner landmark */}
      <header className="cs-erp4-banner" role="banner" aria-label={ERP4_MODULE_LABEL}>
        <p className="cs-erp4-eyebrow">ClearShift ERP · Module 4</p>
        <p className="cs-erp4-module-title">{ERP4_MODULE_LABEL}</p>
      </header>

      <div className="cs-erp4-body">
        <ModuleNav pathname={location.pathname} />

        <div className="cs-erp4-content">
          <div className="cs-erp4-breadcrumb">
            <ModuleBreadcrumbs pathname={location.pathname} />
          </div>

          <main
            id={ERP4_MAIN_REGION_ID}
            className="cs-erp4-main"
            tabIndex={-1}
            aria-label={`${ERP4_MODULE_LABEL} content`}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
};

export default ModuleShell;
