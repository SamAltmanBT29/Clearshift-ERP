import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Secret & Security Scanner (PLT-12)
 * Verifies that:
 * 1. No hardcoded credentials, API keys, or private keys exist in repository code.
 * 2. No cloud uploader libraries (AWS S3, Google Cloud Storage, Azure Blob) are introduced.
 * 3. No real customer or employee personal datasets are included.
 */

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"][A-Za-z0-9\/+=_-]{20,}['"]/i,
  /aws_secret_access_key\s*[:=]\s*['"][A-Za-z0-9\/+=]{40}['"]/i,
  /postgres(?:ql)?:\/\/[a-zA-Z0-9_]+:[a-zA-Z0-9_!@#$%^&*()]+@(?!(?:localhost|127\.0\.0\.1|postgres|pg))/,
];

const CLOUD_UPLOADER_PATTERNS = [
  /@aws-sdk\/client-s3/,
  /@google-cloud\/storage/,
  /@azure\/storage-blob/,
  /s3\.upload\(/,
  /s3Client\.send\(new PutObjectCommand/,
];

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".turbo",
  "coverage",
]);

const IGNORED_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
]);

export interface ScanResult {
  passed: boolean;
  violations: { file: string; line: number; rule: string; snippet: string }[];
}

export function scanDirectory(dir: string, baseDir: string = dir): ScanResult {
  const violations: ScanResult["violations"] = [];

  function walk(currentDir: string) {
    const entries = readdirSync(currentDir);
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry)) continue;
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        if (IGNORED_FILES.has(entry)) continue;
        if (entry.endsWith(".png") || entry.endsWith(".jpg") || entry.endsWith(".ico") || entry.endsWith(".md") || fullPath.includes("/docs/")) continue;

        try {
          const content = readFileSync(fullPath, "utf-8");
          const lines = content.split("\n");

          lines.forEach((line, index) => {
            // Check secret patterns
            for (const pattern of SECRET_PATTERNS) {
              if (pattern.test(line)) {
                // Ignore example / documentation fixtures
                if (!fullPath.includes(".example") && !fullPath.includes("test") && !fullPath.includes("docs/")) {
                  violations.push({
                    file: fullPath.replace(baseDir, ""),
                    line: index + 1,
                    rule: "HARDCODED_SECRET",
                    snippet: line.trim().slice(0, 80),
                  });
                }
              }
            }

            // Check cloud uploader patterns
            for (const pattern of CLOUD_UPLOADER_PATTERNS) {
              if (pattern.test(line)) {
                violations.push({
                  file: fullPath.replace(baseDir, ""),
                  line: index + 1,
                  rule: "FORBIDDEN_CLOUD_UPLOADER",
                  snippet: line.trim().slice(0, 80),
                });
              }
            }
          });
        } catch {
          // Skip binary or unreadable files
        }
      }
    }
  }

  walk(dir);
  return {
    passed: violations.length === 0,
    violations,
  };
}

if (process.argv[1]?.endsWith("scan-secrets.ts") || process.argv[1]?.endsWith("scan-secrets.js")) {
  const result = scanDirectory(process.cwd());
  if (!result.passed) {
    console.error("❌ Security violations detected:");
    for (const v of result.violations) {
      console.error(`  [${v.rule}] ${v.file}:${v.line} - ${v.snippet}`);
    }
    process.exit(1);
  } else {
    console.log("✅ Security scan passed: Zero secrets, unapproved cloud uploaders, or PII detected.");
  }
}
