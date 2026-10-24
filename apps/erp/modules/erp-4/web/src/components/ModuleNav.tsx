/**
 * ERP-4 Finance and Accounting — Module Navigation
 *
 * Renders the semantic sidebar navigation hierarchy for ERP-4,
 * grouped by operational categories (General Ledger, Financial Reports, Migration & Quality),
 * with accessible landmarks and segment-aware `aria-current="page"` indicators.
 *
 * @module erp4/web/components/ModuleNav
 */

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ERP4_NAV_GROUPS,
  erp4NavItems,
  erp4RoutePath,
  isErp4PathActive,
  type Erp4RouteDescriptor,
} from '../route-manifest.js';

export interface ModuleNavProps {
  /** Overrides current pathname — useful for headless testing. */
  readonly pathname?: string;
}

export const ModuleNav: React.FC<ModuleNavProps> = ({ pathname }) => {
  const location = useLocation();
  const currentPath = pathname ?? location.pathname;
  const items = erp4NavItems();

  return (
    <nav className="cs-erp4-nav" aria-label="Finance and Accounting">
      {ERP4_NAV_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group.id);
        if (groupItems.length === 0) {
          return null;
        }
        const headingId = `cs-erp4-nav-group-${group.id}`;
        return (
          <div className="cs-erp4-nav-group" key={group.id}>
            <h2 className="cs-erp4-nav-group-title" id={headingId}>
              {group.label}
            </h2>
            <ul className="cs-erp4-nav-list" aria-labelledby={headingId}>
              {groupItems.map((item: Erp4RouteDescriptor) => {
                const target = erp4RoutePath(item);
                const isActive = isErp4PathActive(target, currentPath);
                return (
                  <li className="cs-erp4-nav-item" key={item.id}>
                    <Link
                      to={target}
                      aria-current={isActive ? 'page' : undefined}
                      className={`cs-erp4-nav-link${isActive ? ' is-active' : ''}`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
};

export default ModuleNav;
