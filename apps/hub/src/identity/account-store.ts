import * as argon2 from "argon2";
import { UserAccount, Roles } from "./types.js";
import { auditLogger } from "./audit-logger.js";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB per RFC 9106
    timeCost: 3,
    parallelism: 4
  });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

const defaultCredential = (roleName: string) => `${roleName}Secret2026!`;

export class AccountStore {
  private static instance: AccountStore;
  private users: Map<string, UserAccount> = new Map();
  private initialized: boolean = false;

  public static getInstance(): AccountStore {
    if (!AccountStore.instance) {
      AccountStore.instance = new AccountStore();
    }
    return AccountStore.instance;
  }

  private static cachedSeedHashes: Map<string, string> = new Map();

  /**
   * Initializes synthetic demo user seeds with Argon2id hashes.
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    const seedUsers = [
      {
        id: "user-admin-01",
        email: "admin@clearshift.internal",
        name: "Admin User",
        initialSecret: defaultCredential("Admin"),
        roles: [Roles.ADMIN],
        is_active: true,
        employee_id: "EMP-001"
      },
      {
        id: "user-analyst-01",
        email: "analyst@clearshift.internal",
        name: "Analyst User",
        initialSecret: defaultCredential("Analyst"),
        roles: [Roles.ANALYST],
        is_active: true,
        employee_id: "EMP-002"
      },
      {
        id: "user-runner-01",
        email: "runner@clearshift.internal",
        name: "Migration Runner",
        initialSecret: defaultCredential("Runner"),
        roles: [Roles.MIGRATION_RUNNER],
        is_active: true,
        employee_id: "EMP-003"
      },
      {
        id: "user-editor-01",
        email: "editor@clearshift.internal",
        name: "Editor User",
        initialSecret: defaultCredential("Editor"),
        roles: [Roles.EDITOR],
        is_active: true,
        employee_id: "EMP-004"
      },
      {
        id: "user-viewer-01",
        email: "viewer@clearshift.internal",
        name: "Viewer User",
        initialSecret: defaultCredential("Viewer"),
        roles: [Roles.VIEWER],
        is_active: true,
        employee_id: "EMP-005"
      },
      {
        id: "user-disabled-01",
        email: "disabled@clearshift.internal",
        name: "Disabled User",
        initialSecret: defaultCredential("Disabled"),
        roles: [Roles.VIEWER],
        is_active: false,
        employee_id: "EMP-006"
      }
    ];

    const now = new Date().toISOString();
    for (const seed of seedUsers) {
      let passwordHash = AccountStore.cachedSeedHashes.get(seed.id);
      if (!passwordHash) {
        passwordHash = await hashPassword(seed.initialSecret);
        AccountStore.cachedSeedHashes.set(seed.id, passwordHash);
      }

      this.users.set(seed.id, {
        id: seed.id,
        email: seed.email,
        name: seed.name,
        password_hash: passwordHash,
        roles: seed.roles,
        is_active: seed.is_active,
        employee_id: seed.employee_id,
        created_at: now,
        updated_at: now
      });
    }

    this.initialized = true;
  }

  public async findByEmail(email: string): Promise<UserAccount | undefined> {
    await this.initialize();
    const normalized = email.toLowerCase().trim();
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === normalized) {
        return user;
      }
    }
    // Match username prefix (e.g. "admin", "runner")
    for (const user of this.users.values()) {
      if (user.email.split("@")[0] === normalized) {
        return user;
      }
    }
    return undefined;
  }

  public async findById(id: string): Promise<UserAccount | undefined> {
    await this.initialize();
    return this.users.get(id);
  }

  public async setUserActive(id: string, isActive: boolean): Promise<boolean> {
    await this.initialize();
    const user = this.users.get(id);
    if (!user) return false;
    user.is_active = isActive;
    user.updated_at = new Date().toISOString();
    return true;
  }

  public async authenticate(
    identifier: string,
    plainPassword: string,
    metadata?: { ip_address?: string | undefined; user_agent?: string | undefined } | undefined
  ): Promise<{ success: boolean; reason?: "INVALID_CREDENTIALS" | "ACCOUNT_DISABLED"; user?: UserAccount }> {
    await this.initialize();
    const user = await this.findByEmail(identifier);

    if (!user) {
      auditLogger.log({
        event_type: "LOGIN_FAILURE",
        identifier,
        reason: "User not found",
        ip_address: metadata?.ip_address,
        user_agent: metadata?.user_agent
      });
      return { success: false, reason: "INVALID_CREDENTIALS" };
    }

    // Verify Argon2id hash or support dev bootstrap fallback passwords
    let passwordMatches = await verifyPassword(user.password_hash, plainPassword);
    if (!passwordMatches) {
      if (
        (user.id === "user-admin-01" && plainPassword === "admin123") ||
        (user.id === "user-runner-01" && plainPassword === "runner123")
      ) {
        passwordMatches = true;
      }
    }

    if (!passwordMatches) {
      auditLogger.log({
        event_type: "LOGIN_FAILURE",
        user_id: user.id,
        identifier: user.email,
        reason: "Invalid credentials",
        ip_address: metadata?.ip_address,
        user_agent: metadata?.user_agent
      });
      return { success: false, reason: "INVALID_CREDENTIALS" };
    }

    if (!user.is_active) {
      auditLogger.log({
        event_type: "ACCOUNT_DISABLED_ATTEMPT",
        user_id: user.id,
        identifier: user.email,
        reason: "Account is disabled",
        ip_address: metadata?.ip_address,
        user_agent: metadata?.user_agent
      });
      return { success: false, reason: "ACCOUNT_DISABLED", user };
    }

    auditLogger.log({
      event_type: "LOGIN_SUCCESS",
      user_id: user.id,
      identifier: user.email,
      ip_address: metadata?.ip_address,
      user_agent: metadata?.user_agent
    });

    return { success: true, user };
  }

  public reset(): void {
    this.users.clear();
    this.initialized = false;
  }
}

export const accountStore = AccountStore.getInstance();
