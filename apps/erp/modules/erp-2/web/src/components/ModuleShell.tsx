/**
 * ERP-2 Vendors & Purchasing — Module Layout Shell
 *
 * Common layout shell wrapping every screen in the module:
 *   skip link → banner → navigation → breadcrumbs → main region
 *
 * Implements accessible ARIA landmarks and dynamic browser document title sync.
 *
 * @module erp2/web/components/ModuleShell
 */

import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ModuleBreadcrumbs } from './ModuleBreadcrumbs.js';
import { ModuleNav } from './ModuleNav.js';
import { ERP2_MODULE_LABEL, resolveErp2DocumentTitle } from '../route-manifest.js';

/** Identifier of the main region — target of the keyboard skip link. */
export const ERP2_MAIN_REGION_ID = 'erp2-main';

export const ModuleShell: React.FC = () => {
  const location = useLocation();
  const documentTitle = resolveErp2DocumentTitle(location.pathname);

  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  return (
    <div className="cs-erp2-shell">
      {/* Keyboard accessible skip link (first focusable item) */}
      <a className="cs-erp2-skip-link" href={`#${ERP2_MAIN_REGION_ID}`}>
        Skip to main content
      </a>

      {/* Module banner landmark */}
      <header className="cs-erp2-banner" role="banner" aria-label={ERP2_MODULE_LABEL}>
        <p className="cs-erp2-eyebrow">ClearShift ERP · Module 2</p>
        <p className="cs-erp2-module-title">{ERP2_MODULE_LABEL}</p>
      </header>

      <div className="cs-erp2-body">
        <ModuleNav pathname={location.pathname} />

        <div className="cs-erp2-content">
          <div className="cs-erp2-breadcrumb">
            <ModuleBreadcrumbs pathname={location.pathname} />
          </div>

          <main
            id={ERP2_MAIN_REGION_ID}
            className="cs-erp2-main"
            tabIndex={-1}
            aria-label={`${ERP2_MODULE_LABEL} content`}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
};

export default ModuleShell;
