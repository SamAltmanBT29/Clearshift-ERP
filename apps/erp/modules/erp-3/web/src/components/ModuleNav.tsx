/**
 * ERP-3 Sales Orders and Invoices — Module Navigation
 *
 * The navigation hierarchy of the module. It renders one `nav` landmark per
 * module, grouped by the groups declared in the route manifest, and marks the
 * entry that owns the current location with `aria-current="page"`.
 *
 * @module erp3/web/components/ModuleNav
 */

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ERP3_NAV_GROUPS,
  erp3NavItems,
  erp3RoutePath,
  isErp3PathActive,
  type Erp3RouteDescriptor,
} from '../route-manifest.js';

export interface ModuleNavProps {
  /** Overrides the current location — used by tests. */
  readonly pathname?: string;
}

export const ModuleNav: React.FC<ModuleNavProps> = ({ pathname }) => {
  const location = useLocation();
  const currentPath = pathname ?? location.pathname;
  const items = erp3NavItems();

  return (
    <nav className="cs-erp3-nav" aria-label="Sales Orders and Invoices">
      {ERP3_NAV_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group.id);
        if (groupItems.length === 0) {
          return null;
        }
        const headingId = `cs-erp3-nav-group-${group.id}`;
        return (
          <div className="cs-erp3-nav-group" key={group.id}>
            <h2 className="cs-erp3-nav-group-title" id={headingId}>
              {group.label}
            </h2>
            <ul className="cs-erp3-nav-list" aria-labelledby={headingId}>
              {groupItems.map((item: Erp3RouteDescriptor) => {
                const target = erp3RoutePath(item);
                const isActive = isErp3PathActive(target, currentPath);
                return (
                  <li className="cs-erp3-nav-item" key={item.id}>
                    <Link
                      to={target}
                      aria-current={isActive ? 'page' : undefined}
                      className={`cs-erp3-nav-link${isActive ? ' is-active' : ''}`}
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
