/**
 * ERP-5 HR & Employees — Client-side Permission Helper
 *
 * The **server** is the authority on authorization: every ERP-5 endpoint
 * enforces the shared capability matrix before it touches a row. The browser
 * only needs to know one thing — *may this session be offered the action at
 * all?* — so that a user without the permission is never shown an action
 * that is certain to be refused with a 403.
 *
 * The decision is taken with the **shared central matrix** (PLT-06,
 * `packages/core/src/auth/permissions.ts`) — never with a local copy of the
 * role list, so the client can never drift from the server policy.
 *
 * @module erp5/web/auth/permissions
 */

import {
  Actions,
  Resources,
  Roles,
  hasPermission,
  type RoleType,
} from '@cs/core/auth/permissions.js';

const KNOWN_ROLES: ReadonlySet<string> = new Set<string>(Object.values(Roles));

/**
 * Narrows the role claims of a session to the roles the platform knows.
 *
 * An unknown role grants nothing — the matrix is default-deny.
 */
export function toRoleTypes(roles: readonly string[]): RoleType[] {
  return roles.filter((role): role is RoleType => KNOWN_ROLES.has(role));
}

/**
 * May the session create an HR master record (employee, department, leave)?
 *
 * **Why `Resources.EMPLOYEES` stands in for the whole HR master data.**
 * The central matrix declares a resource for employees but none for
 * departments or leave records, while the module's write guard is the shared
 * `module.write` capability — granted to exactly the roles the matrix grants
 * `CREATE` on `EMPLOYEES` (Editor and Admin). Asking the matrix for
 * `CREATE` on `EMPLOYEES` therefore answers the department and leave
 * questions correctly today, and it keeps answering them correctly when the
 * platform adds the missing resources.
 *
 * Follow-up for Platform: declare `DEPARTMENTS` and `LEAVE` resources in the
 * central matrix so the question can be asked per resource.
 */
export function canCreateHrRecord(roles: readonly string[]): boolean {
  return hasPermission(toRoleTypes(roles), Actions.CREATE, Resources.EMPLOYEES);
}
