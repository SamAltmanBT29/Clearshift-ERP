/**
 * ERP-4 Finance and Accounting — Error Sanitizer Utility
 *
 * Sanitizes API and runtime errors to protect sensitive information,
 * prevent raw stack traces from being rendered to users, and map
 * domain error codes to helpful, accessible business messages.
 *
 * @module erp4/web/utils/error-sanitizer
 */

export interface SanitizedErrorInfo {
  title: string;
  message: string;
  isForbidden: boolean;
  isUnauthorized: boolean;
  isNotFound: boolean;
  code?: string;
  statusCode?: number;
  requiredRoles?: string[];
  suggestedAction?: string;
}

/**
 * Regex patterns identifying raw runtime stack traces, file paths, or internal DB statements
 * that must NEVER be leaked to the end-user interface.
 */
const STACK_TRACE_PATTERNS = [
  /\bat\s+.+\(.*:\d+:\d+\)/i,                // V8 stack line: at Function (path:line:col)
  /\bat\s+async\s+.+\(.*:\d+:\d+\)/i,         // V8 async stack line
  /\b(?:node_modules|webpack-internal|\.tsx?:\d+|\.jsx?:\d+)/i, // source paths with line numbers
  /\b(?:TypeError|ReferenceError|SyntaxError|RangeError):/i,     // JS runtime engine exceptions
  /\b(?:ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET)\b/i,        // Low-level socket errors
  /\b(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|UPDATE\s+.+\s+SET|DELETE\s+FROM)\b/i, // Raw SQL statements
  /\b(?:drizzle-orm|pg-pool|fastify)\b/i,     // Framework internals
];

/**
 * Standard ClearShift Finance Domain Role Mappings for 403 errors
 */
export const DEFAULT_FINANCE_ROLES: string[] = [
  'Finance Admin',
  'Finance Editor',
  'Finance Viewer',
  'Auditor',
];

/**
 * Known ClearShift Domain Error Codes and user-facing friendly explanations
 */
const DOMAIN_CODE_MAPPINGS: Record<string, { title: string; message: string }> = {
  JOURNAL_UNBALANCED: {
    title: 'Double-Entry Invariant Violation',
    message: 'Every posted journal entry must be balanced at currency precision (total debits must equal total credits).',
  },
  PERIOD_CLOSED: {
    title: 'Accounting Period Closed',
    message: 'The target accounting period is closed. Transactions and postings cannot be recorded in closed periods.',
  },
  PERIOD_SOFT_CLOSED: {
    title: 'Accounting Period Soft-Closed',
    message: 'The target accounting period is soft-closed and requires finance_admin authorization to post.',
  },
  ACCOUNT_LOCKED: {
    title: 'Account Inactive or Locked',
    message: 'This financial account is currently locked or inactive and cannot accept transactions.',
  },
  DUPLICATE_CODE: {
    title: 'Duplicate Identifier Conflict',
    message: 'An account or journal with this code or number already exists in the Chart of Accounts.',
  },
  CONFLICT: {
    title: 'Resource Conflict',
    message: 'A conflicting record was detected. The operation could not be completed with the current state.',
  },
  NOT_FOUND: {
    title: 'Record Not Found',
    message: 'The requested financial record could not be found or has been removed.',
  },
  UNAUTHORIZED: {
    title: 'Authentication Required',
    message: 'Your session has expired or authentication credentials are missing. Please log in again.',
  },
  FORBIDDEN: {
    title: 'Access Denied',
    message: 'You do not have the required permissions or role to view or modify this Finance resource.',
  },
  VALIDATION_ERROR: {
    title: 'Validation Error',
    message: 'One or more submitted fields failed validation. Please review your entries and try again.',
  },
};

/**
 * Tests whether a string contains sensitive stack traces, source paths, or SQL statements.
 */
export function containsRawStackTrace(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  return STACK_TRACE_PATTERNS.some((pattern) => pattern.test(str));
}

/**
 * Strips raw stack frames, paths, and DB internals, returning a clean sanitized error.
 */
export function sanitizeErrorMessage(error: unknown, fallbackResource = 'Finance data'): SanitizedErrorInfo {
  if (!error) {
    return {
      title: 'Unknown Error',
      message: `An unexpected issue occurred while processing ${fallbackResource}.`,
      isForbidden: false,
      isUnauthorized: false,
      isNotFound: false,
    };
  }

  // Extract properties safely from ApiError or standard Error / object
  const errObj = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const status: number =
    typeof errObj['status'] === 'number'
      ? errObj['status']
      : typeof errObj['statusCode'] === 'number'
      ? errObj['statusCode']
      : 0;
  const rawCode: string = typeof errObj['code'] === 'string' ? errObj['code'].toUpperCase() : '';
  const rawMessage: string =
    typeof errObj['message'] === 'string'
      ? errObj['message']
      : typeof error === 'string'
      ? error
      : '';
  const rawStack: string = typeof errObj['stack'] === 'string' ? errObj['stack'] : '';

  // 1. Detect 403 Forbidden
  if (status === 403 || rawCode === 'FORBIDDEN' || rawCode === 'FORBIDDEN_RESOURCE') {
    return {
      title: 'Access Denied (403 Forbidden)',
      message: 'You do not have the required permissions or role to perform this action in Finance & Accounting.',
      isForbidden: true,
      isUnauthorized: false,
      isNotFound: false,
      code: 'FORBIDDEN',
      statusCode: 403,
      requiredRoles: DEFAULT_FINANCE_ROLES,
      suggestedAction: 'Please contact your system administrator or PMO security officer to request access.',
    };
  }

  // 2. Detect 401 Unauthorized
  if (status === 401 || rawCode === 'UNAUTHORIZED') {
    return {
      title: 'Authentication Required (401)',
      message: 'Your session has expired or you are not signed in. Please log in to continue.',
      isForbidden: false,
      isUnauthorized: true,
      isNotFound: false,
      code: 'UNAUTHORIZED',
      statusCode: 401,
      suggestedAction: 'Please sign in with valid credentials.',
    };
  }

  // 3. Detect 404 Not Found
  if (status === 404 || rawCode === 'NOT_FOUND') {
    return {
      title: 'Record Not Found (404)',
      message: `The requested ${fallbackResource} could not be found.`,
      isForbidden: false,
      isUnauthorized: false,
      isNotFound: true,
      code: 'NOT_FOUND',
      statusCode: 404,
      suggestedAction: 'Check the URL or return to the main directory.',
    };
  }

  // 4. Match domain error codes
  if (rawCode && DOMAIN_CODE_MAPPINGS[rawCode]) {
    const mapping = DOMAIN_CODE_MAPPINGS[rawCode]!;
    return {
      title: mapping.title,
      message: mapping.message,
      isForbidden: false,
      isUnauthorized: false,
      isNotFound: false,
      code: rawCode,
      statusCode: status || 400,
    };
  }

  // 5. Stack Trace / Internal Leak Detection: If rawMessage or rawStack has stack frames or SQL
  const hasStackOrLeak = containsRawStackTrace(rawMessage) || containsRawStackTrace(rawStack);

  if (hasStackOrLeak) {
    return {
      title: 'Server Communication Error',
      message: `A server or network error occurred while communicating with the Finance API. Technical diagnostics have been safely preserved in system logs.`,
      isForbidden: false,
      isUnauthorized: false,
      isNotFound: false,
      code: 'SERVER_ERROR',
      statusCode: status || 500,
      suggestedAction: 'Please retry your request. If the error persists, contact technical support.',
    };
  }

  // 6. Safe user message without stack traces
  const cleanMessage = rawMessage.trim();
  if (cleanMessage) {
    return {
      title: 'Request Failed',
      message: cleanMessage,
      isForbidden: false,
      isUnauthorized: false,
      isNotFound: false,
      code: rawCode || 'REQUEST_FAILED',
      statusCode: status || 400,
      suggestedAction: 'Please retry or verify your input parameters.',
    };
  }

  // Fallback
  return {
    title: 'Unexpected Error',
    message: `An unexpected error occurred while communicating with the Finance API.`,
    isForbidden: false,
    isUnauthorized: false,
    isNotFound: false,
    code: 'UNKNOWN_ERROR',
    statusCode: status || 500,
  };
}
