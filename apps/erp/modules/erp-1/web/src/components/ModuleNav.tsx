/**
 * ERP-1 Products & Inventory — Module Navigation
 *
 * Renders the primary navigation landmark for the module, grouped by the
 * groups declared in the route manifest, and marks the active entry with
 * `aria-current="page"`.
 *
 * @module erp1/web/components/ModuleNav
 */

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ERP1_NAV_GROUPS,
  erp1NavItems,
  erp1RoutePath,
  isErp1PathActive,
  type Erp1RouteDescriptor,
} from '../route-manifest.js';

export interface ModuleNavProps {
  /** Overrides the current location — used by tests. */
  readonly pathname?: string;
}

export const ModuleNav: React.FC<ModuleNavProps> = ({ pathname }) => {
  const location = useLocation();
  const currentPath = pathname ?? location.pathname;
  const items = erp1NavItems();

  return (
    <nav className="cs-erp1-nav" aria-label="Products & Inventory">
      {ERP1_NAV_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group.id);
        if (groupItems.length === 0) {
          return null;
        }
        const headingId = `cs-erp1-nav-group-${group.id}`;
        return (
          <div className="cs-erp1-nav-group" key={group.id}>
            <h2 className="cs-erp1-nav-group-title" id={headingId}>
              {group.label}
            </h2>
            <ul className="cs-erp1-nav-list" aria-labelledby={headingId}>
              {groupItems.map((item: Erp1RouteDescriptor) => {
                const target = erp1RoutePath(item);
                const isActive = isErp1PathActive(target, currentPath);
                return (
                  <li className="cs-erp1-nav-item" key={item.id}>
                    <Link
                      to={target}
                      aria-current={isActive ? 'page' : undefined}
                      className={`cs-erp1-nav-link${isActive ? ' is-active' : ''}`}
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
