export const Roles = {
  VIEWER: "viewer",
  EDITOR: "editor",
  MIGRATION_RUNNER: "migration_runner",
  ANALYST: "analyst",
  ADMIN: "admin"
} as const;

export type RoleType = typeof Roles[keyof typeof Roles];

export interface HubTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  jti: string;
  exp: number;
  roles: RoleType[];
  employee_id?: string;
}
