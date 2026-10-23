import { AuditLogEntry, AuthEventType } from "./types.js";
import { randomUUID } from "node:crypto";

export class IdentityAuditLogger {
  private static instance: IdentityAuditLogger;
  private readonly logs: AuditLogEntry[] = [];

  public static getInstance(): IdentityAuditLogger {
    if (!IdentityAuditLogger.instance) {
      IdentityAuditLogger.instance = new IdentityAuditLogger();
    }
    return IdentityAuditLogger.instance;
  }

  /**
   * Log an authentication event.
   * STRICT SECURITY INVARIANT: Passwords, raw credentials, and access tokens
   * MUST NEVER be passed or recorded in audit entries.
   */
  public log(event: {
    event_type: AuthEventType;
    user_id?: string | undefined;
    identifier?: string | undefined;
    reason?: string | undefined;
    ip_address?: string | undefined;
    user_agent?: string | undefined;
  }): AuditLogEntry {
    // Sanitize identifier to prevent accidental token or credential leakage
    let sanitizedIdentifier = event.identifier;
    if (sanitizedIdentifier && sanitizedIdentifier.length > 120) {
      sanitizedIdentifier = sanitizedIdentifier.substring(0, 120) + "...[truncated]";
    }

    const entry: AuditLogEntry = {
      id: randomUUID(),
      event_type: event.event_type,
      ...(event.user_id ? { user_id: event.user_id } : {}),
      ...(sanitizedIdentifier ? { identifier: sanitizedIdentifier } : {}),
      ...(event.reason ? { reason: event.reason } : {}),
      ...(event.ip_address ? { ip_address: event.ip_address } : {}),
      ...(event.user_agent ? { user_agent: event.user_agent } : {}),
      timestamp: new Date().toISOString()
    };

    this.logs.push(entry);
    return entry;
  }

  public getLogs(): readonly AuditLogEntry[] {
    return [...this.logs];
  }

  public clear(): void {
    this.logs.length = 0;
  }
}

export const auditLogger = IdentityAuditLogger.getInstance();
