import React from "react";

export type StatusBadgeVariant = "success" | "warning" | "error" | "neutral" | "info";

export type StatusBadgeType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense"
  | "draft"
  | "posted"
  | "voided"
  | "active"
  | "inactive";

export interface StatusBadgeProps {
  label?: string;
  variant?: StatusBadgeVariant;
  type?: StatusBadgeType;
  className?: string;
}

const typeVariantMap: Record<StatusBadgeType, StatusBadgeVariant> = {
  asset: "info",
  liability: "warning",
  equity: "neutral",
  revenue: "success",
  expense: "error",
  draft: "neutral",
  posted: "success",
  voided: "error",
  active: "success",
  inactive: "neutral"
};

const variantClasses: Record<StatusBadgeVariant, string> = {
  success: "bg-[var(--cs-ok-bg)] text-[var(--cs-ok)] border-[var(--cs-ok)]/30",
  warning: "bg-[var(--cs-warn-bg)] text-[var(--cs-warn)] border-[var(--cs-warn)]/30",
  error: "bg-[var(--cs-err-bg)] text-[var(--cs-err)] border-[var(--cs-err)]/30",
  neutral: "bg-[var(--cs-surface)] text-[var(--cs-text-muted)] border-[var(--cs-border)]",
  info: "bg-[var(--cs-surface)] text-[var(--cs-accent)] border-[var(--cs-accent)]/30"
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  label,
  variant,
  type,
  className = ""
}) => {
  const resolvedVariant = variant || (type ? typeVariantMap[type] : "neutral");
  const displayLabel = label || (type ? type.toUpperCase() : "");
  const styleClass = variantClasses[resolvedVariant];

  return (
    <span
      className={`cs-status-badge inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${styleClass} ${className}`}
      data-variant={resolvedVariant}
      data-type={type}
    >
      {displayLabel}
    </span>
  );
};
