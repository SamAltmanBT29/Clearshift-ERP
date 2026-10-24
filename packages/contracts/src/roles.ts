import { z } from "zod";

/**
 * ClearShift Standard Roles (PLT-06 / SDS §9.3)
 */
export const Roles = {
  VIEWER: "viewer",
  EDITOR: "editor",
  MIGRATION_RUNNER: "migration_runner",
  ANALYST: "analyst",
  ADMIN: "admin"
} as const;

export type RoleType = typeof Roles[keyof typeof Roles];

export const RoleSchema = z.enum([
  Roles.VIEWER,
  Roles.EDITOR,
  Roles.MIGRATION_RUNNER,
  Roles.ANALYST,
  Roles.ADMIN
]);

/**
 * Standard Actions across ClearShift Resources
 */
export const Actions = {
  READ: "read",
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  EXECUTE_BULK: "execute_bulk",
  APPROVE_MERGE: "approve_merge",
  EXPORT: "export",
  MANAGE_USERS: "manage_users",
  VIEW_AUDIT: "view_audit"
} as const;

export type ActionType = typeof Actions[keyof typeof Actions];

/**
 * ClearShift Resource Identifiers
 */
export const Resources = {
  // ERP-3 Sales Orders & Invoices
  ERP3_SALES_ORDERS: "erp3_sales_orders",
  ERP3_INVOICES: "erp3_invoices",
  ERP3_PAYMENTS: "erp3_payments",
  ERP3_IMPORTS: "erp3_imports",

  // Finance & Accounting (ERP-4)
  ACCOUNTS: "accounts",
  JOURNAL_ENTRIES: "journal_entries",
  TRIAL_BALANCE: "trial_balance",
  ACCOUNTING_PERIODS: "accounting_periods",
  OPENING_BALANCES: "opening_balances",

  // Human Resources (ERP-5)
  EMPLOYEES: "employees",
  PAYROLL: "payroll",
  COMPENSATION: "compensation",

  // Purchasing & Vendors (ERP-2)
  VENDORS: "vendors",
  PURCHASE_ORDERS: "purchase_orders",

  // Migration Kit
  MIGRATION_BATCHES: "migration_batches",
  MIGRATION_RUNS: "migration_runs",
  MIGRATION_MERGES: "migration_merges",
  KNOWN_PROBLEMS: "known_problems",

  // System & Platform
  CONTROL_CENTER: "control_center",
  AUDIT_LOGS: "audit_logs",
  USER_ACCOUNTS: "user_accounts",
  SIGNING_KEYS: "signing_keys"
} as const;

export type ResourceType = typeof Resources[keyof typeof Resources];
