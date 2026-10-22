import { randomBytes, createHash } from "node:crypto";
import { RefreshSession } from "./types.js";
import { accountStore } from "./account-store.js";
import { auditLogger } from "./audit-logger.js";

export class SessionStore {
  private static instance: SessionStore;
  private sessions: Map<string, RefreshSession> = new Map(); // key is session_id

  public static getInstance(): SessionStore {
    if (!SessionStore.instance) {
      SessionStore.instance = new SessionStore();
    }
    return SessionStore.instance;
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /**
   * Creates a new refresh session. Returns raw refreshToken and csrfToken to caller.
   */
  public async createSession(
    userId: string,
    metadata?: { ip_address?: string | undefined; user_agent?: string | undefined; ttlDays?: number | undefined } | undefined
  ): Promise<{ session: RefreshSession; rawRefreshToken: string; csrfToken: string }> {
    const rawRefreshToken = randomBytes(32).toString("hex");
    const csrfToken = randomBytes(24).toString("hex");
    const sessionId = `sess_${randomBytes(16).toString("hex")}`;
    const tokenHash = this.hashToken(rawRefreshToken);
    const ttlDays = metadata?.ttlDays || 7;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    const session: RefreshSession = {
      session_id: sessionId,
      user_id: userId,
      token_hash: tokenHash,
      csrf_token: csrfToken,
      expires_at: expiresAt,
      created_at: new Date(),
      ip_address: metadata?.ip_address,
      user_agent: metadata?.user_agent
    };

    this.sessions.set(sessionId, session);
    return { session, rawRefreshToken: `${sessionId}.${rawRefreshToken}`, csrfToken };
  }

  /**
   * Validates refresh token, checks expiration, checks revocation, verifies CSRF token,
   * verifies user account is active, and performs token rotation.
   */
  public async rotateSession(
    rawRefreshToken: string,
    csrfTokenHeader?: string | undefined,
    metadata?: { ip_address?: string | undefined; user_agent?: string | undefined } | undefined
  ): Promise<{
    success: boolean;
    reason?: "INVALID_TOKEN" | "EXPIRED" | "REVOKED" | "CSRF_FAILED" | "ACCOUNT_DISABLED";
    newRawRefreshToken?: string;
    newCsrfToken?: string;
    userId?: string;
  }> {
    const parts = rawRefreshToken.split(".");
    if (parts.length !== 2) {
      auditLogger.log({
        event_type: "TOKEN_REFRESH_FAILURE",
        reason: "Malformed refresh token format",
        ip_address: metadata?.ip_address
      });
      return { success: false, reason: "INVALID_TOKEN" };
    }

    const [sessionId, secret] = parts;
    const session = this.sessions.get(sessionId!);
    if (!session) {
      auditLogger.log({
        event_type: "TOKEN_REFRESH_FAILURE",
        reason: "Session not found",
        ip_address: metadata?.ip_address
      });
      return { success: false, reason: "INVALID_TOKEN" };
    }

    if (session.revoked_at) {
      auditLogger.log({
        event_type: "TOKEN_REFRESH_FAILURE",
        user_id: session.user_id,
        reason: "Session has been revoked",
        ip_address: metadata?.ip_address
      });
      return { success: false, reason: "REVOKED" };
    }

    if (session.expires_at.getTime() < Date.now()) {
      auditLogger.log({
        event_type: "TOKEN_REFRESH_FAILURE",
        user_id: session.user_id,
        reason: "Session has expired",
        ip_address: metadata?.ip_address
      });
      return { success: false, reason: "EXPIRED" };
    }

    const tokenHash = this.hashToken(secret!);
    if (tokenHash !== session.token_hash) {
      auditLogger.log({
        event_type: "TOKEN_REFRESH_FAILURE",
        user_id: session.user_id,
        reason: "Token hash mismatch",
        ip_address: metadata?.ip_address
      });
      return { success: false, reason: "INVALID_TOKEN" };
    }

    // CSRF Protection for state-changing cookie auth
    if (!csrfTokenHeader || csrfTokenHeader !== session.csrf_token) {
      auditLogger.log({
        event_type: "TOKEN_REFRESH_FAILURE",
        user_id: session.user_id,
        reason: "CSRF token mismatch or missing",
        ip_address: metadata?.ip_address
      });
      return { success: false, reason: "CSRF_FAILED" };
    }

    // Verify user account is still active!
    const user = await accountStore.findById(session.user_id);
    if (!user || !user.is_active) {
      session.revoked_at = new Date();
      auditLogger.log({
        event_type: "TOKEN_REFRESH_FAILURE",
        user_id: session.user_id,
        reason: "User account is disabled or missing",
        ip_address: metadata?.ip_address
      });
      return { success: false, reason: "ACCOUNT_DISABLED" };
    }

    // Revoke old session and issue new rotated session (Session Rotation)
    session.revoked_at = new Date();

    const { rawRefreshToken: newRawRefreshToken, csrfToken: newCsrfToken } = await this.createSession(
      session.user_id,
      metadata
    );

    auditLogger.log({
      event_type: "TOKEN_REFRESH_SUCCESS",
      user_id: session.user_id,
      ip_address: metadata?.ip_address
    });

    return {
      success: true,
      newRawRefreshToken,
      newCsrfToken,
      userId: session.user_id
    };
  }

  /**
   * Revokes a session (used on logout).
   */
  public revokeSession(rawRefreshToken: string): boolean {
    const parts = rawRefreshToken.split(".");
    if (parts.length !== 2) return false;
    const sessionId = parts[0]!;
    const session = this.sessions.get(sessionId);
    if (session) {
      session.revoked_at = new Date();
      auditLogger.log({
        event_type: "LOGOUT",
        user_id: session.user_id
      });
      return true;
    }
    return false;
  }

  public reset(): void {
    this.sessions.clear();
  }
}

export const sessionStore = SessionStore.getInstance();
