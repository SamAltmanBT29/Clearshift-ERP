/**
 * ERP-2 Vendors & Purchasing — Module Navigation
 *
 * Renders the semantic sidebar navigation hierarchy for ERP-2,
 * grouped by operational categories (Purchasing, Integration),
 * with accessible landmarks and segment-aware `aria-current="page"` indicators.
 *
 * @module erp2/web/components/ModuleNav
 */

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ERP2_NAV_GROUPS,
  erp2NavItems,
  erp2RoutePath,
  isErp2PathActive,
  type Erp2RouteDescriptor,
} from '../route-manifest.js';

export interface ModuleNavProps {
  /** Overrides current pathname — useful for headless testing. */
  readonly pathname?: string;
}

export const ModuleNav: React.FC<ModuleNavProps> = ({ pathname }) => {
  const location = useLocation();
  const currentPath = pathname ?? location.pathname;
  const items = erp2NavItems();

  return (
    <nav className="cs-erp2-nav" aria-label="Vendors and Purchasing">
      {ERP2_NAV_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group.id);
        if (groupItems.length === 0) {
          return null;
        }
        const headingId = `cs-erp2-nav-group-${group.id}`;
        return (
          <div className="cs-erp2-nav-group" key={group.id}>
            <h2 className="cs-erp2-nav-group-title" id={headingId}>
              {group.label}
            </h2>
            <ul className="cs-erp2-nav-list" aria-labelledby={headingId}>
              {groupItems.map((item: Erp2RouteDescriptor) => {
                const target = erp2RoutePath(item);
                const isActive = isErp2PathActive(target, currentPath);
                return (
                  <li className="cs-erp2-nav-item" key={item.id}>
                    <Link
                      to={target}
                      aria-current={isActive ? 'page' : undefined}
                      className={`cs-erp2-nav-link${isActive ? ' is-active' : ''}`}
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
