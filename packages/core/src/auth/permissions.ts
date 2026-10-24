import { Roles, RoleType, Actions, ActionType, Resources, ResourceType } from "@clearshift/contracts";

export { Roles, RoleType, Actions, ActionType, Resources, ResourceType };

/**
 * Fixed Role Permission Matrix (PLT-06 / SDS §9.3)
 * Default policy is DEFAULT DENY.
 */
export const ROLE_PERMISSIONS: Record<RoleType, Partial<Record<ResourceType, ActionType[]>>> = {
  [Roles.VIEWER]: {
    [Resources.ERP3_SALES_ORDERS]: [Actions.READ],
    [Resources.ERP3_INVOICES]: [Actions.READ],
    [Resources.ERP3_PAYMENTS]: [Actions.READ],
    [Resources.ACCOUNTS]: [Actions.READ, Actions.EXPORT],
    [Resources.JOURNAL_ENTRIES]: [Actions.READ, Actions.EXPORT],
    [Resources.TRIAL_BALANCE]: [Actions.READ, Actions.EXPORT],
    [Resources.ACCOUNTING_PERIODS]: [Actions.READ],
    [Resources.OPENING_BALANCES]: [Actions.READ],
    [Resources.EMPLOYEES]: [Actions.READ],
    [Resources.VENDORS]: [Actions.READ],
    [Resources.PURCHASE_ORDERS]: [Actions.READ],
    [Resources.MIGRATION_BATCHES]: [Actions.READ],
    [Resources.KNOWN_PROBLEMS]: [Actions.READ],
    [Resources.CONTROL_CENTER]: [Actions.READ],
  },

  [Roles.EDITOR]: {
    [Resources.ERP3_SALES_ORDERS]: [Actions.READ, Actions.CREATE, Actions.UPDATE],
    [Resources.ERP3_INVOICES]: [Actions.READ, Actions.CREATE],
    [Resources.ERP3_PAYMENTS]: [Actions.READ, Actions.CREATE],
    [Resources.ACCOUNTS]: [Actions.READ, Actions.CREATE, Actions.UPDATE, Actions.EXPORT],
    [Resources.JOURNAL_ENTRIES]: [Actions.READ, Actions.CREATE, Actions.UPDATE, Actions.EXPORT],
    [Resources.TRIAL_BALANCE]: [Actions.READ, Actions.EXPORT],
    [Resources.ACCOUNTING_PERIODS]: [Actions.READ],
    [Resources.OPENING_BALANCES]: [Actions.READ],
    [Resources.EMPLOYEES]: [Actions.READ, Actions.CREATE, Actions.UPDATE],
    [Resources.VENDORS]: [Actions.READ, Actions.CREATE, Actions.UPDATE, Actions.EXPORT],
    [Resources.PURCHASE_ORDERS]: [Actions.READ, Actions.CREATE, Actions.UPDATE, Actions.EXPORT],
    [Resources.MIGRATION_BATCHES]: [Actions.READ],
    [Resources.KNOWN_PROBLEMS]: [Actions.READ],
    [Resources.CONTROL_CENTER]: [Actions.READ],
  },

  [Roles.MIGRATION_RUNNER]: {
    [Resources.ERP3_SALES_ORDERS]: [Actions.CREATE],
    [Resources.ERP3_INVOICES]: [Actions.CREATE],
    [Resources.ERP3_PAYMENTS]: [Actions.CREATE],
    [Resources.ERP3_IMPORTS]: [Actions.EXECUTE_BULK],
    // Migration Runner executes bulk loads but CANNOT approve its own merge/skip decisions
    [Resources.MIGRATION_BATCHES]: [Actions.READ, Actions.CREATE, Actions.EXECUTE_BULK],
    [Resources.MIGRATION_RUNS]: [Actions.READ, Actions.EXECUTE_BULK],
    [Resources.OPENING_BALANCES]: [Actions.READ, Actions.EXECUTE_BULK],
    [Resources.PAYROLL]: [Actions.READ, Actions.EXECUTE_BULK],
    [Resources.ACCOUNTS]: [Actions.READ],
    [Resources.JOURNAL_ENTRIES]: [Actions.READ],
    [Resources.KNOWN_PROBLEMS]: [Actions.READ],
    [Resources.CONTROL_CENTER]: [Actions.READ],
  },

  [Roles.ANALYST]: {
    [Resources.ACCOUNTS]: [Actions.READ, Actions.EXPORT],
    [Resources.JOURNAL_ENTRIES]: [Actions.READ, Actions.EXPORT],
    [Resources.TRIAL_BALANCE]: [Actions.READ, Actions.EXPORT],
    [Resources.ACCOUNTING_PERIODS]: [Actions.READ],
    [Resources.OPENING_BALANCES]: [Actions.READ],
    [Resources.EMPLOYEES]: [Actions.READ],
    [Resources.VENDORS]: [Actions.READ],
    [Resources.PURCHASE_ORDERS]: [Actions.READ],
    [Resources.MIGRATION_BATCHES]: [Actions.READ],
    [Resources.KNOWN_PROBLEMS]: [Actions.READ],
    [Resources.CONTROL_CENTER]: [Actions.READ],
    [Resources.AUDIT_LOGS]: [Actions.READ, Actions.VIEW_AUDIT],
  },

  [Roles.ADMIN]: {
    [Resources.ERP3_SALES_ORDERS]: [Actions.READ, Actions.CREATE, Actions.UPDATE, Actions.DELETE, Actions.EXPORT],
    [Resources.ERP3_INVOICES]: [Actions.READ, Actions.CREATE, Actions.UPDATE, Actions.DELETE, Actions.EXPORT],
    [Resources.ERP3_PAYMENTS]: [Actions.READ, Actions.CREATE, Actions.UPDATE, Actions.DELETE, Actions.EXPORT],
    [Resources.ERP3_IMPORTS]: [Actions.EXECUTE_BULK],
    [Resources.ACCOUNTS]: [Actions.READ, Actions.CREATE, Actions.UPDATE, Actions.DELETE, Actions.EXPORT],
    [Resources.JOURNAL_ENTRIES]: [Actions.READ, Actions.CREATE, Actions.UPDATE, Actions.DELETE, Actions.EXPORT],
    [Resources.TRIAL_BALANCE]: [Actions.READ, Actions.EXPORT],
    [Resources.ACCOUNTING_PERIODS]: [Actions.READ, Actions.UPDATE],
    [Resources.OPENING_BALANCES]: [Actions.READ],
    [Resources.EMPLOYEES]: [Actions.READ, Actions.CREATE, Actions.UPDATE, Actions.DELETE],
    [Resources.PAYROLL]: [Actions.READ, Actions.UPDATE],
    [Resources.COMPENSATION]: [Actions.READ, Actions.UPDATE],
    [Resources.VENDORS]: [Actions.READ, Actions.CREATE, Actions.UPDATE, Actions.DELETE, Actions.EXPORT],
    [Resources.PURCHASE_ORDERS]: [Actions.READ, Actions.CREATE, Actions.UPDATE, Actions.DELETE, Actions.EXPORT],
    [Resources.MIGRATION_BATCHES]: [Actions.READ, Actions.UPDATE, Actions.DELETE, Actions.APPROVE_MERGE],
    [Resources.MIGRATION_MERGES]: [Actions.READ, Actions.APPROVE_MERGE],
    [Resources.KNOWN_PROBLEMS]: [Actions.READ, Actions.UPDATE],
    [Resources.CONTROL_CENTER]: [Actions.READ],
    [Resources.AUDIT_LOGS]: [Actions.READ, Actions.VIEW_AUDIT],
    [Resources.USER_ACCOUNTS]: [Actions.READ, Actions.CREATE, Actions.UPDATE, Actions.DELETE, Actions.MANAGE_USERS],
    [Resources.SIGNING_KEYS]: [Actions.READ, Actions.UPDATE],
  }
};

/**
 * Checks if user's roles grant permission for the given action and resource.
 * Policy: DEFAULT DENY.
 */
export function hasPermission(
  userRoles: RoleType[],
  action: ActionType,
  resource: ResourceType
): boolean {
  if (!userRoles || userRoles.length === 0) {
    return false;
  }

  for (const role of userRoles) {
    const resourcePermissions = ROLE_PERMISSIONS[role]?.[resource];
    if (resourcePermissions && resourcePermissions.includes(action)) {
      return true;
    }
  }

  return false;
}

/**
 * Sensitive field definitions and masking rules.
 * NON-NEGOTIABLE SECURITY CONSTRAINTS:
 * 1. Passwords, hashes, tokens: NEVER visible to any role (including Admin).
 * 2. Bank details & government IDs: NEVER visible to any role in clear text (masked).
 * 3. Salary: Visible to Admin only; masked for Viewer, Editor, Analyst, and Migration Runner.
 */
export const SENSITIVE_FIELDS = {
  CREDENTIALS: ["password", "password_hash", "token", "secret", "access_token", "refresh_token", "token_hash"],
  BANK_DETAILS: ["bank_account_number", "iban", "routing_number", "bank_account", "account_number"],
  GOVERNMENT_IDS: ["ssn", "tax_id", "national_id", "government_id"],
  SALARY: ["salary", "base_pay", "hourly_rate", "compensation", "annual_salary"]
} as const;

export function maskLastDigits(val: string, visibleDigits: number = 4): string {
  if (!val || val.length <= visibleDigits) return "****";
  const unmasked = val.slice(-visibleDigits);
  return `****-****-${unmasked}`;
}

export function maskGovernmentId(val: string): string {
  if (!val || val.length <= 4) return "***-**-****";
  const unmasked = val.slice(-4);
  return `***-**-${unmasked}`;
}

/**
 * Applies field-level masking server-side before response serialization or CSV export.
 */
export function maskSensitiveFields<T extends Record<string, any>>(
  record: T,
  viewerRoles: RoleType[]
): T {
  if (!record || typeof record !== "object") {
    return record;
  }

  const isAdmin = viewerRoles.includes(Roles.ADMIN);
  const result: Record<string, any> = Array.isArray(record) ? [...record] : { ...record };

  for (const [key, value] of Object.entries(result)) {
    const lowerKey = key.toLowerCase();

    // 1. Credentials / Passwords / Tokens: NEVER VISIBLE TO ANY ROLE
    if (SENSITIVE_FIELDS.CREDENTIALS.some((field) => lowerKey === field || lowerKey.endsWith(`_${field}`))) {
      result[key] = "[REDACTED]";
      continue;
    }

    // 2. Bank Details: MASKED FOR ALL ROLES (including Admin)
    if (SENSITIVE_FIELDS.BANK_DETAILS.some((field) => lowerKey === field || lowerKey.endsWith(`_${field}`))) {
      result[key] = typeof value === "string" ? maskLastDigits(value) : "****-****-****";
      continue;
    }

    // 3. Government IDs / SSN: MASKED FOR ALL ROLES (including Admin)
    if (SENSITIVE_FIELDS.GOVERNMENT_IDS.some((field) => lowerKey === field || lowerKey.endsWith(`_${field}`))) {
      result[key] = typeof value === "string" ? maskGovernmentId(value) : "***-**-****";
      continue;
    }

    // 4. Salary / Compensation: VISIBLE TO ADMIN ONLY
    if (SENSITIVE_FIELDS.SALARY.some((field) => lowerKey === field || lowerKey.endsWith(`_${field}`))) {
      if (!isAdmin) {
        result[key] = typeof value === "number" ? 0 : "[REDACTED]";
      }
      continue;
    }

    // Recurse into nested objects
    if (value && typeof value === "object" && !(value instanceof Date)) {
      result[key] = maskSensitiveFields(value, viewerRoles);
    }
  }

  return result as T;
}

/**
 * Masks tabular/CSV records before export.
 */
export function maskCsvRecord(
  record: Record<string, any>,
  viewerRoles: RoleType[]
): Record<string, any> {
  return maskSensitiveFields(record, viewerRoles);
}
