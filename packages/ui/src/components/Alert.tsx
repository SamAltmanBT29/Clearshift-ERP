import React from "react";

export type AlertVariant = "info" | "success" | "warning" | "error";

export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
  id?: string;
  "data-testid"?: string;
}

const variantStyles: Record<AlertVariant, { container: string; text: string; icon: string; role: "alert" | "status" }> = {
  info: {
    container: "border-[var(--cs-accent)] bg-[var(--cs-surface)]",
    text: "text-[var(--cs-accent)]",
    icon: "ℹ",
    role: "status"
  },
  success: {
    container: "border-[var(--cs-ok)] bg-[var(--cs-ok-bg)]",
    text: "text-[var(--cs-ok)]",
    icon: "✓",
    role: "status"
  },
  warning: {
    container: "border-[var(--cs-warn)] bg-[var(--cs-warn-bg)]",
    text: "text-[var(--cs-warn)]",
    icon: "⚠",
    role: "alert"
  },
  error: {
    container: "border-[var(--cs-err)] bg-[var(--cs-err-bg)]",
    text: "text-[var(--cs-err)]",
    icon: "✕",
    role: "alert"
  }
};

export const Alert: React.FC<AlertProps> = ({
  variant = "info",
  title,
  children,
  onDismiss,
  className = "",
  id,
  "data-testid": testId
}) => {
  const styles = variantStyles[variant];

  return (
    <div
      id={id}
      data-testid={testId}
      role={styles.role}
      className={`cs-alert rounded border p-4 ${styles.container} ${className}`}
    >

      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <span className={`text-base font-bold ${styles.text}`} aria-hidden="true">
            {styles.icon}
          </span>
          <div className="text-sm">
            {title && (
              <h3 className={`font-semibold mb-1 ${styles.text}`}>
                {title}
              </h3>
            )}
            <div className="text-[var(--cs-text)]">{children}</div>
          </div>
        </div>

        {onDismiss && (
          <button
            type="button"
            aria-label="Dismiss alert"
            onClick={onDismiss}
            className={`text-sm font-semibold hover:opacity-75 focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)] rounded p-1 ${styles.text}`}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
};
