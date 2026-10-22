import { RoleType, Roles } from "@cs/identity";

export { RoleType, Roles };

export interface HubTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
  kid: string;
  roles: RoleType[];
  employee_id?: string | undefined;
}

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  roles: RoleType[];
  is_active: boolean;
  employee_id?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface RefreshSession {
  session_id: string;
  user_id: string;
  token_hash: string;
  csrf_token: string;
  expires_at: Date;
  revoked_at?: Date | undefined;
  created_at: Date;
  ip_address?: string | undefined;
  user_agent?: string | undefined;
}

export type AuthEventType =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILURE"
  | "LOGOUT"
  | "TOKEN_REFRESH_SUCCESS"
  | "TOKEN_REFRESH_FAILURE"
  | "ACCOUNT_DISABLED_ATTEMPT"
  | "KEY_ROTATION";

export interface AuditLogEntry {
  id: string;
  event_type: AuthEventType;
  user_id?: string | undefined;
  identifier?: string | undefined;
  reason?: string | undefined;
  ip_address?: string | undefined;
  user_agent?: string | undefined;
  timestamp: string;
}
