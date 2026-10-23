/**
 * ERP-5 HR & Employees — Module Navigation
 *
 * The navigation hierarchy of the module. It renders one `nav` landmark per
 * module, grouped by the groups declared in the route manifest, and marks the
 * entry that owns the current location with `aria-current="page"`.
 *
 * @module erp5/web/components/ModuleNav
 */

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ERP5_NAV_GROUPS,
  erp5NavItems,
  erp5RoutePath,
  isErp5PathActive,
  type Erp5RouteDescriptor,
} from '../route-manifest.js';

export interface ModuleNavProps {
  /** Overrides the current location — used by tests. */
  readonly pathname?: string;
}

export const ModuleNav: React.FC<ModuleNavProps> = ({ pathname }) => {
  const location = useLocation();
  const currentPath = pathname ?? location.pathname;
  const items = erp5NavItems();

  return (
    <nav className="cs-erp5-nav" aria-label="HR and Employees">
      {ERP5_NAV_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group.id);
        if (groupItems.length === 0) {
          return null;
        }
        const headingId = `cs-erp5-nav-group-${group.id}`;
        return (
          <div className="cs-erp5-nav-group" key={group.id}>
            <h2 className="cs-erp5-nav-group-title" id={headingId}>
              {group.label}
            </h2>
            <ul className="cs-erp5-nav-list" aria-labelledby={headingId}>
              {groupItems.map((item: Erp5RouteDescriptor) => {
                const target = erp5RoutePath(item);
                const isActive = isErp5PathActive(target, currentPath);
                return (
                  <li className="cs-erp5-nav-item" key={item.id}>
                    {/*
                      The active state is computed here rather than taken from
                      `NavLink`, so the module decides — segment-boundary
                      aware — which entry owns the current location. `NavLink`
                      also sets `aria-current` itself, and its value would
                      silently win over an explicit one.
                    */}
                    <Link
                      to={target}
                      aria-current={isActive ? 'page' : undefined}
                      className={`cs-erp5-nav-link${isActive ? ' is-active' : ''}`}
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
