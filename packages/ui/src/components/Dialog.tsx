import React, { useEffect, useRef } from "react";

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  className = ""
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = "cs-dialog-title";
  const descId = description ? "cs-dialog-description" : undefined;

  // Keyboard navigation: Escape key closes the modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className={`cs-dialog w-full max-w-lg rounded-lg border border-[var(--cs-border)] bg-[var(--cs-bg)] p-6 shadow-xl focus:outline-none ${className}`}
        tabIndex={-1}
      >
        <div className="flex items-start justify-between pb-4 border-b border-[var(--cs-border)]">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-[var(--cs-text)]">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-[var(--cs-text-muted)]">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="rounded p-1 text-[var(--cs-text-muted)] hover:bg-[var(--cs-surface)] hover:text-[var(--cs-text)] focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)]"
          >
            ✕
          </button>
        </div>

        <div className="py-4 text-[var(--cs-text)]">
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--cs-border)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
