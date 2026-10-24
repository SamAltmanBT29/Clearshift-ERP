import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { readAccessToken } from './session.js';

export const RequireAuth: React.FC = () => {
  const token = readAccessToken();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
};