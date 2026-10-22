/**
 * Sensitive Data Redaction Utilities (PLT-10 / PLT-11)
 * Guarantees that passwords, JWTs, secrets, full bank details, full salary,
 * government IDs, and complete raw rows never leak to logs, errors, or audit trails.
 */

const JWT_REGEX = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/;
const BEARER_AUTH_REGEX = /Bearer\s+[A-Za-z0-9-_.]+/gi;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const CREDIT_CARD_REGEX = /\b(?:\d{4}[ -]?){3}\d{4}\b/g;
const INLINE_SECRET_REGEX = /(password|secret|token|api_key|credential|private_key)[=:\s]+([^\s,;]+)/gi;

const SENSITIVE_KEY_EXACT = new Set([
  "password",
  "passwd",
  "pass",
  "argon2hash",
  "passwordhash",
  "secret",
  "jwt",
  "token",
  "refreshtoken",
  "tokenhash",
  "privateenc",
  "signingkey",
  "privatekey",
  "clientsecret",
  "authorization",
  "auth",
  "apikey",
  "ssn",
  "taxid",
  "nationalid",
  "aadhaar",
  "pan",
  "identitynumber",
  "salary",
  "basesalary",
  "compensation",
  "wage",
  "hourlyrate",
  "bankaccount",
  "accountnumber",
  "iban",
  "routingnumber",
  "swift",
  "cvv",
  "cardnumber",
  "rawrow",
  "rawpayload",
]);

const SENSITIVE_KEY_SUBSTRINGS = [
  "password",
  "secret",
  "token",
  "credential",
  "privatekey",
  "private_key",
  "api_key",
  "bank_account",
  "account_num",
  "tax_id",
  "identity_num",
];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  if (SENSITIVE_KEY_EXACT.has(normalized)) return true;
  return SENSITIVE_KEY_SUBSTRINGS.some((sub) => normalized.includes(sub.replace(/[-_]/g, "")));
}

export function maskSensitiveString(value: string): string {
  if (value.length <= 4) {
    return "[REDACTED]";
  }
  return `****${value.slice(-4)}`;
}

export function redactSensitiveData<T>(obj: T, visited: WeakSet<object> = new WeakSet()): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    let sanitized: string = obj;
    if (JWT_REGEX.test(sanitized)) {
      return "[REDACTED_JWT]" as unknown as T;
    }
    sanitized = sanitized.replace(BEARER_AUTH_REGEX, "Bearer [REDACTED_TOKEN]");
    sanitized = sanitized.replace(SSN_REGEX, "[REDACTED_SSN]");
    sanitized = sanitized.replace(CREDIT_CARD_REGEX, "[REDACTED_CARD]");
    sanitized = sanitized.replace(INLINE_SECRET_REGEX, "$1=[REDACTED_SECRET]");
    return sanitized as unknown as T;
  }

  if (typeof obj !== "object") {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }

  if (visited.has(obj as object)) {
    return "[CIRCULAR_REFERENCE]" as unknown as T;
  }
  visited.add(obj as object);

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item, visited)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      if (typeof value === "string") {
        if (key.toLowerCase().includes("bank") || key.toLowerCase().includes("account")) {
          result[key] = maskSensitiveString(value);
        } else if (key.toLowerCase().includes("salary") || key.toLowerCase().includes("wage")) {
          result[key] = "[REDACTED_FINANCIAL]";
        } else if (key.toLowerCase().includes("ssn") || key.toLowerCase().includes("tax") || key.toLowerCase().includes("id")) {
          result[key] = "[REDACTED_ID]";
        } else {
          result[key] = "[REDACTED_SECRET]";
        }
      } else if (typeof value === "number") {
        result[key] = "[REDACTED_FINANCIAL]";
      } else if (value && typeof value === "object" && (key === "credentials" || key === "auth" || key === "security")) {
        result[key] = redactSensitiveData(value, visited);
      } else {
        result[key] = "[REDACTED]";
      }
    } else {
      result[key] = redactSensitiveData(value, visited);
    }
  }

  return result as T;
}

export function redactErrorMessage(error: unknown): string {
  if (!error) return "Unknown error";
  const rawMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  let sanitized = redactSensitiveData(rawMessage);
  sanitized = sanitized.replace(BEARER_AUTH_REGEX, "Bearer [REDACTED_TOKEN]");
  sanitized = sanitized.replace(JWT_REGEX, "[REDACTED_JWT]");
  sanitized = sanitized.replace(SSN_REGEX, "[REDACTED_SSN]");
  sanitized = sanitized.replace(INLINE_SECRET_REGEX, "$1=[REDACTED_SECRET]");

  return sanitized;
}
