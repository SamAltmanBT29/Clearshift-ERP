/**
 * ERP-3 Sales Orders and Invoices — Authentication Route Guard
 *
 * Guards the whole module route tree. A session that is absent or expired is
 * redirected to the Hub login screen with a `returnTo` parameter, so the
 * operator lands back on the screen they asked for once the Hub has issued a
 * token.
 *
 * @module erp3/web/auth/RequireAuth
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
