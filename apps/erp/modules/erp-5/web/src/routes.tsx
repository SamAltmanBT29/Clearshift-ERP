/**
 * ERP-5 HR & Employees — Module Route Table
 *
 * The React Router route objects of the module.
 *
 * The nesting is deliberate:
 *
 *   `/erp5`                → `RequireAuth`  — authentication gate for the module
 *     └─ (layout)          → `ModuleShell`  — landmarks, navigation, title
 *          └─ (children)   → the screens
 *
 * A screen can therefore never render outside the shell, and no screen can
 * render at all without a session.
 *
 * Architecture reference: ClearShift V1 Master Architecture Spec §3.1
 * (`/erp5/{employees,departments,leave}`) and §6.1 (slot 16 — route table
 * registration).
 *
 * @module erp5/web/routes
 */

import React from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth.js';
import { ModuleShell } from './components/ModuleShell.js';
import { DepartmentsPage } from './pages/DepartmentsPage.js';
import { DepartmentCreatePage } from './pages/DepartmentCreatePage.js';
import { DepartmentDetailPage } from './pages/DepartmentDetailPage.js';
import { EmployeeCreatePage } from './pages/EmployeeCreatePage.js';
import { EmployeeDetailPage } from './pages/EmployeeDetailPage.js';
import { EmployeesPage } from './pages/EmployeesPage.js';
import { IdentityUsersPage } from './pages/IdentityUsersPage.js';
import { LeaveCreatePage } from './pages/LeaveCreatePage.js';
import { LeaveDetailPage } from './pages/LeaveDetailPage.js';
import { LeavePage } from './pages/LeavePage.js';
import { ModuleNotFoundPage } from './pages/ModuleNotFoundPage.js';
import { PayrollTotalsPage } from './pages/PayrollTotalsPage.js';
import { ERP5_BASE_PATH } from './route-manifest.js';

export const erp5Routes: RouteObject[] = [
  {
    id: 'erp5',
    path: ERP5_BASE_PATH,
    element: <RequireAuth />,
    children: [
      {
        id: 'erp5-shell',
        element: <ModuleShell />,
        children: [
          {
            id: 'erp5-index',
            index: true,
            element: <Navigate to="/erp5/employees" replace />,
          },
          {
            id: 'erp5-employees',
            path: 'employees',
            element: <EmployeesPage />,
          },
          {
            id: 'erp5-employees-create',
            path: 'employees/new',
            element: <EmployeeCreatePage />,
          },
          {
            id: 'erp5-employees-detail',
            path: 'employees/:employeeId',
            element: <EmployeeDetailPage />,
          },
          {
            id: 'erp5-departments',
            path: 'departments',
            element: <DepartmentsPage />,
          },
          {
            id: 'erp5-departments-create',
            path: 'departments/new',
            element: <DepartmentCreatePage />,
          },
          {
            id: 'erp5-departments-detail',
            path: 'departments/:departmentId',
            element: <DepartmentDetailPage />,
          },
          {
            id: 'erp5-leave',
            path: 'leave',
            element: <LeavePage />,
          },
          {
            id: 'erp5-leave-create',
            path: 'leave/new',
            element: <LeaveCreatePage />,
          },
          {
            id: 'erp5-leave-detail',
            path: 'leave/:leaveId',
            element: <LeaveDetailPage />,
          },
          {
            id: 'erp5-payroll-totals',
            path: 'payroll-totals',
            element: <PayrollTotalsPage />,
          },
          {
            id: 'erp5-identity-users',
            path: 'identity-users',
            element: <IdentityUsersPage />,
          },
          {
            id: 'erp5-not-found',
            path: '*',
            element: <ModuleNotFoundPage />,
          },
        ],
      },
    ],
  },
];

export default erp5Routes;
