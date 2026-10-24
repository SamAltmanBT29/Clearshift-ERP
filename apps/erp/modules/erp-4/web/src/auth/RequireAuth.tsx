/**
 * ERP-4 Finance & Accounting — Authentication Route Guard
 *
 * Enforces session authentication across all ERP-4 routes.
 * If the session is missing or expired, redirects the user to the Hub login
 * preserving the return path in `returnTo`.
 *
 * @module erp4/web/auth/RequireAuth
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
