/**
 * ERP-1 Products & Inventory — Authentication Route Guard
 *
 * Guards the module route tree. An absent or expired session redirects
 * to the Hub login screen with a `returnTo` parameter.
 *
 * @module erp1/web/auth/RequireAuth
 */

import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { HUB_LOGIN_PATH } from '../route-manifest.js';
import { getSession } from './session.js';

export const RequireAuth: React.FC = () => {
  const location = useLocation();
  const session = getSession();

  if (!session) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`${HUB_LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`}
        replace
        state={{ from: returnTo }}
      />
    );
  }

  return <Outlet />;
};

export default RequireAuth;
