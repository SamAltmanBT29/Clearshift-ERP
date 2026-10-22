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

export * from './route-manifest.js';
export * from './routes.js';
export * from './auth/session.js';
export * from './auth/RequireAuth.js';
export * from './components/ModuleShell.js';
export * from './components/ModuleNav.js';
export * from './components/ModuleBreadcrumbs.js';
export * from './pages/ModulePlaceholderPage.js';
export * from './pages/ModuleNotFoundPage.js';
