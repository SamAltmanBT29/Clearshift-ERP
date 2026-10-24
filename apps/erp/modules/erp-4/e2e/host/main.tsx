/**
 * Browser entry for the ERP-4 Playwright host. Mounts the real module routes
 * plus a stub Hub login so the auth redirect can be asserted.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { erp4Routes } from '../../web/src/routes.js';
import '../../web/src/theme.css';

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/erp4" replace /> },
  { path: '/login', element: <p>Hub login (E2E host stub)</p> },
  ...erp4Routes,
]);

createRoot(document.getElementById('root') as HTMLElement).render(
  <RouterProvider router={router} />,
);
