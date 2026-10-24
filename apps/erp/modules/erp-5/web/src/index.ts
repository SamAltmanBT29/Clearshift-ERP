/**
 * ERP-5 HR & Employees — Web Public Facade
 *
 * The entry point a host application imports to mount the module:
 *
 * ```tsx
 * import { erp5Routes } from '@cs/mod-erp5/web';
 * ```
 *
 * The facade is also what makes the module's `.tsx` sources part of the
 * repository's TypeScript program: the root `tsconfig.json` includes every
 * `.ts` file under `apps/`, and this file pulls the route table and the
 * shell into the graph.
 *
 * @module erp5/web
 */

export * from './kit-metadata.js';
export * from './rejection-context.js';
export * from './route-manifest.js';
export * from './routes.js';
export * from './api/erp-5.js';
export * from './auth/session.js';
export * from './auth/RequireAuth.js';
export * from './auth/permissions.js';
export * from './components/ModuleShell.js';
export * from './components/ModuleNav.js';
export * from './components/ModuleBreadcrumbs.js';
export * from './components/ListFilterBar.js';
export * from './components/ListStateBoundary.js';
export * from './components/PermissionDeniedState.js';
export * from './components/FormPageLayout.js';
export * from './components/RecordDetail.js';
export * from './components/RecordStateBoundary.js';
export * from './components/forms/FormControls.js';
export * from './components/forms/ConfirmActionDialog.js';
export * from './components/forms/EmployeeForm.js';
export * from './components/forms/DepartmentForm.js';
export * from './components/forms/LeaveForm.js';
export * from './components/EmployeesTable.js';
export * from './components/DepartmentsTable.js';
export * from './components/LeaveTable.js';
export * from './components/PayrollTotalsTable.js';
export * from './components/IdentityUsersTable.js';
export * from './hooks/useDebouncedValue.js';
export * from './hooks/useDepartmentLookup.js';
export * from './hooks/useEmployeeLookup.js';
export * from './hooks/useHrForm.js';
export * from './hooks/useHrList.js';
export * from './hooks/useHrRecord.js';
export * from './utils/format.js';
export * from './pages/ModuleNotFoundPage.js';
export * from './pages/EmployeesListPage.js';
export * from './pages/DepartmentsListPage.js';
export * from './pages/LeaveListPage.js';
export * from './pages/PayrollTotalsListPage.js';
export * from './pages/IdentityUsersListPage.js';
export * from './pages/EmployeeCreatePage.js';
export * from './pages/EmployeeEditPage.js';
export * from './pages/EmployeeDetailPage.js';
export * from './pages/DepartmentCreatePage.js';
export * from './pages/DepartmentEditPage.js';
export * from './pages/DepartmentDetailPage.js';
export * from './pages/LeaveCreatePage.js';
export * from './pages/LeaveEditPage.js';
export * from './pages/LeaveDetailPage.js';
