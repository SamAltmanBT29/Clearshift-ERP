import { tokens } from "./tokens.js";

export interface TailwindConfig {
  content: string[];
  darkMode?: [string, string] | string;
  theme?: {
    extend?: Record<string, any>;
  };
  plugins?: any[];
}

/**
 * ClearShift Shared UI Tailwind Configuration (PLT-08)
 */
const config: TailwindConfig = {
  content: [
    "./src/**/*.{ts,tsx,html}",
    "../../apps/**/*.{ts,tsx,html}",
  ],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        cs: {
          bg: tokens.colors.bg,
          surface: tokens.colors.surface,
          border: tokens.colors.border,
          text: tokens.colors.text,
          muted: tokens.colors.textMuted,
          accent: tokens.colors.accent,
          "accent-hover": tokens.colors.accentHover,
          ok: tokens.colors.ok,
          "ok-bg": tokens.colors.okBg,
          warn: tokens.colors.warn,
          "warn-bg": tokens.colors.warnBg,
          err: tokens.colors.err,
          "err-bg": tokens.colors.errBg,
        },
      },
      spacing: {
        "cs-1": tokens.spacing.s1,
        "cs-2": tokens.spacing.s2,
        "cs-3": tokens.spacing.s3,
        "cs-4": tokens.spacing.s4,
        "cs-5": tokens.spacing.s5,
        "cs-6": tokens.spacing.s6,
        "cs-8": tokens.spacing.s8,
        "cs-10": tokens.spacing.s10,
        "cs-12": tokens.spacing.s12,
      },
      borderRadius: {
        "cs-sm": tokens.radius.sm,
        "cs-md": tokens.radius.md,
        "cs-lg": tokens.radius.lg,
      },
      fontFamily: {
        sans: [tokens.fontFamily.sans],
        mono: [tokens.fontFamily.mono],
      },
      boxShadow: {
        "cs-focus": tokens.shadow.focus,
      },
    },
  },
  plugins: [],
};

export default config;
