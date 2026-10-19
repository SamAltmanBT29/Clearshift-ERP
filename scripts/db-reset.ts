/**
 * Safe Database Reset Script (Section 1 & PMO-04)
 * Strict safety guard: refuses to run against any non-test/dev DSN.
 */

const ALLOWED_HOSTS = ["localhost", "127.0.0.1", "postgres"];
const ALLOWED_DB_NAMES = ["clearshift", "clearshift_test", "clearshift_dev"];

export function assertSafeDatabaseUrl(urlStr: string): void {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname;
    const dbName = parsed.pathname.replace(/^\//, "");

    if (!ALLOWED_HOSTS.includes(host)) {
      throw new Error(
        `[SECURITY GUARD] Refusing database reset! Host '${host}' is not in the safe development allowlist (${ALLOWED_HOSTS.join(", ")}).`
      );
    }

    const isAllowedDb = ALLOWED_DB_NAMES.includes(dbName) || dbName.endsWith("_test") || dbName.endsWith("_dev");
    if (!isAllowedDb) {
      throw new Error(
        `[SECURITY GUARD] Refusing database reset! Database '${dbName}' is not an authorized test/dev database name.`
      );
    }
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("db-reset.ts") || process.argv[1]?.endsWith("db-reset.js")) {
  const dbUrl = process.env.DATABASE_MIGRATOR_URL || process.env.DATABASE_URL || "postgresql://postgres:postgres_dev_secret@localhost:5432/clearshift";
  assertSafeDatabaseUrl(dbUrl);
  console.log(`✅ [SAFETY GUARD] Verified safe local/test database target: ${dbUrl.replace(/:[^:@]+@/, ":****@")}`);
}
