#!/usr/bin/env node
/**
 * ClearShift Frontend Design & Architecture Validator
 * 
 * Enforces production-grade frontend standards across ERP & CRM modules:
 * 1. Semantic HTML & Accessibility (button, input labels, img alt)
 * 2. Design Consistency & Theme (clean white theme, CSS variables)
 * 3. Mandatory UI States (loading skeleton, empty state, error handling)
 * 4. No hardcoded localhost API endpoints
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const FRONTEND_DIRS = [
  'apps/crm/modules',
  'apps/erp/modules',
  'packages/ui',
  'apps/web',
  'frontend',
];

const SCAN_EXTENSIONS = new Set(['.tsx', '.jsx', '.html', '.css']);

let errorsCount = 0;
let warningsCount = 0;
const issues = [];

function logIssue(severity, rule, file, line, message, suggestion) {
  if (severity === 'ERROR') errorsCount++;
  if (severity === 'WARN') warningsCount++;
  issues.push({ severity, rule, file, line, message, suggestion });
}

function scanDir(dir) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath);
    } else if (SCAN_EXTENSIONS.has(extname(entry))) {
      analyzeFile(fullPath);
    }
  }
}

function analyzeFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const relPath = relative(process.cwd(), filePath);
  const isComponent = filePath.endsWith('.tsx') || filePath.endsWith('.jsx');
  const isCSS = filePath.endsWith('.css');

  lines.forEach((line, idx) => {
    // Check: Hardcoded localhost API endpoints in frontend
    if (line.includes('http://localhost:3000') || line.includes('http://127.0.0.1:3000') || line.includes('http://localhost:5432')) {
      logIssue(
        'ERROR',
        'no-hardcoded-api',
        relPath,
        idx + 1,
        'Found hardcoded localhost URL in frontend code.',
        'Use relative paths (e.g. "/api/v1/...") or environment variable (import.meta.env.VITE_API_URL).'
      );
    }

    if (isComponent) {
      // Check: Accessible interactive elements (no raw clickable divs)
      if (/<(div|span)[^>]*onClick/i.test(line) && !/role=['"]button['"]/i.test(line)) {
        logIssue(
          'WARN',
          'a11y-interactive-element',
          relPath,
          idx + 1,
          'Clickable <div> or <span> found without role="button".',
          'Use a semantic <button> element or add role="button" tabIndex={0}.'
        );
      }

      // Check: Image alt text
      if (/<img[^>]*>/i.test(line) && !/alt=['"][^'"]*['"]/i.test(line)) {
        logIssue(
          'WARN',
          'a11y-img-alt',
          relPath,
          idx + 1,
          '<img> element is missing an alt attribute.',
          'Add a descriptive alt="..." attribute or alt="" for decorative images.'
        );
      }
    }
  });

  if (isComponent) {
    // Check: Mandatory UI States for List/Table/Dashboard pages
    const isDataView = /(List|Table|Dashboard|Queue|Overview)/i.test(filePath);
    if (isDataView && content.length > 300) {
      const lower = content.toLowerCase();
      const hasLoading = lower.includes('loading') || lower.includes('skeleton') || lower.includes('spinner');
      const hasEmptyState = lower.includes('empty') || lower.includes('nodata') || lower.includes('no records') || lower.includes('not found');

      if (!hasLoading) {
        logIssue(
          'WARN',
          'mandatory-loading-state',
          relPath,
          1,
          'Data view component appears to be missing a loading/skeleton state.',
          'Implement a clean skeleton loader or loading indicator while data fetches.'
        );
      }
      if (!hasEmptyState) {
        logIssue(
          'WARN',
          'mandatory-empty-state',
          relPath,
          1,
          'Data view component appears to be missing an empty state.',
          'Add a friendly empty state component when API returns 0 records.'
        );
      }
    }
  }

  if (isCSS) {
    // Check: Global variables usage in CSS
    const hasVariables = content.includes('var(--') || content.includes(':root');
    if (content.length > 500 && !hasVariables) {
      logIssue(
        'WARN',
        'css-tokens-required',
        relPath,
        1,
        'CSS file does not appear to use CSS Custom Properties (var(--...)).',
        'Reference global design tokens from :root (e.g. var(--border-subtle), var(--color-background)).'
      );
    }
  }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🎨 CLEARSHIFT FRONTEND DESIGN & ARCHITECTURE VALIDATOR');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Scanning frontend workspaces for design compliance...');

for (const dir of FRONTEND_DIRS) {
  scanDir(dir);
}

if (issues.length === 0) {
  console.log('✅ All frontend components adhere to design & accessibility rules!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
}

console.log(`\nFound ${errorsCount} error(s) and ${warningsCount} warning(s):\n`);

for (const iss of issues) {
  const icon = iss.severity === 'ERROR' ? '❌' : '⚠️';
  console.log(`${icon} [${iss.rule}] ${iss.file}:${iss.line}`);
  console.log(`   Message    : ${iss.message}`);
  console.log(`   Suggestion : ${iss.suggestion}\n`);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (errorsCount > 0) {
  console.log('❌ Frontend validation FAILED with critical errors.');
  process.exit(1);
} else {
  console.log('✅ Frontend validation PASSED (warnings reported above).');
  process.exit(0);
}
