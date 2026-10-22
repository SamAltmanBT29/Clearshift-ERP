/**
 * ClearShift Design System Tokens (PLT-08)
 * Standardized color, spacing, radius, typography, and elevation scales.
 */

export const tokens = {
  colors: {
    bg: "var(--cs-bg, #FFFFFF)",
    surface: "var(--cs-surface, #F5F6F8)",
    border: "var(--cs-border, #D0D5DD)",
    text: "var(--cs-text, #111827)",
    textMuted: "var(--cs-text-muted, #4B5563)",
    accent: "var(--cs-accent, #1D4ED8)",
    accentHover: "var(--cs-accent-hover, #1E40AF)",
    ok: "var(--cs-ok, #166534)",
    okBg: "var(--cs-ok-bg, #DCFCE7)",
    warn: "var(--cs-warn, #92400E)",
    warnBg: "var(--cs-warn-bg, #FEF3C7)",
    err: "var(--cs-err, #B91C1C)",
    errBg: "var(--cs-err-bg, #FEE2E2)",
  },
  spacing: {
    s1: "4px",
    s2: "8px",
    s3: "12px",
    s4: "16px",
    s5: "20px",
    s6: "24px",
    s8: "32px",
    s10: "40px",
    s12: "48px",
  },
  radius: {
    sm: "2px",
    md: "4px",
    lg: "8px",
    full: "9999px",
  },
  shadow: {
    sm: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
    md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
    focus: "0 0 0 2px #FFFFFF, 0 0 0 4px #1D4ED8",
  },
  fontFamily: {
    sans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
} as const;

export type DesignTokens = typeof tokens;
