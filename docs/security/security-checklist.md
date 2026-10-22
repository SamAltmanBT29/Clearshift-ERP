# ClearShift Security Baseline & Protections Checklist (PLT-12)

## 1. Overview & Architectural Principles

In accordance with **ClearShift Project Plan v3.0 §§9.3–9.6, 17**, this checklist serves as the authoritative security baseline for **Gate G3**. All software components must satisfy these controls before merge and release.

---

## 2. Security Controls Checklist

### 2.1 Synthetic Data & Privacy Protection
- [x] **Synthetic Fixtures Only**: Zero real customer, company, or employee personal data is used in tests, sample datasets, or demonstrations.
- [x] **No Cloud Uploaders**: No AWS S3 SDK (`@aws-sdk/client-s3`), Google Cloud Storage (`@google-cloud/storage`), or Azure Blob SDKs are introduced. All assets and exports reside within local Compose volumes or memory streams.
- [x] **Zero Credentials in Code**: No secrets, passwords, API keys, or private keys are checked into source control or Docker images. Environment variables (`.env.example`) provide synthetic dev defaults.

### 2.2 CSV & Export Formula Injection Protections
- [x] **OWASP Formula Neutralization**: Any cell beginning after leading whitespace with `=`, `+`, `-`, `@`, `\t`, or `\r` is automatically neutralized with a leading single quote (`'`).
- [x] **Database Immutability**: Export sanitization operates on the outbound representation only; stored database records remain unmodified.
- [x] **RFC 4180 Escaping**: All cells containing commas, double quotes, or newlines are wrapped in double quotes, with internal quotes escaped (`""`).

### 2.3 SQL & Database Protections
- [x] **Strict Parameterization**: All SQL queries use Drizzle ORM prepared statements or parameterized `pg` queries. Raw string concatenation in queries is strictly prohibited.
- [x] **Allowlist-Only Dynamic Identifiers**: Any dynamic table, column, or order-by identifier must be validated against a compile-time string literal allowlist via `assertAllowedSqlIdentifier()`.
- [x] **Principle of Least Privilege**: Standard application database role (`cs_app`) has `UPDATE`/`DELETE` revoked on append-only audit tables.

### 2.4 Cross-Site Scripting (XSS) & Input Validation
- [x] **Contextual Output Encoding**: All dynamic user-controlled strings rendered outside React JSX escaping must be sanitized using `escapeHtml()`.
- [x] **Zod Validation**: All inbound HTTP payloads, query parameters, and headers are parsed and bounded by strict Zod schemas before handler execution.
- [x] **Bounded Request Limits**: Maximum request size is 50 MB (for CSV/XLSX migration files). Paging `pageSize` is strictly capped at 100 items.

### 2.5 Automated CI Security Gates
- [x] **Secret Scanning**: Scans for RSA/EC private keys, AWS access keys, and hardcoded tokens on every pull request.
- [x] **Dependency Audit**: `npm audit` and package-lock enforcement block pull requests with high-severity or critical vulnerabilities.
- [x] **Branch Protection & Review**: Pull requests require at least one approving review and clean CI checks before merging.
