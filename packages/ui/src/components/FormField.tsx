import React from "react";

export interface FormFieldProps {
  id: string;
  label: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  id,
  label,
  helperText,
  error,
  required = false,
  disabled = false,
  children,
  className = ""
}) => {
  const helperId = helperText ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`cs-form-field mb-4 ${className}`}>
      <label
        htmlFor={id}
        className={`block text-sm font-medium mb-1.5 ${
          disabled ? "text-[var(--cs-text-muted)] cursor-not-allowed" : "text-[var(--cs-text)]"
        }`}
      >
        {label}
        {required && (
          <span className="text-[var(--cs-err)] ml-1" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {/* If child is provided, inject aria attributes, else placeholder */}
      <div className="relative">
        {React.isValidElement(children)
          ? React.cloneElement(children as React.ReactElement<any>, {
              id,
              disabled,
              required,
              "aria-invalid": !!error,
              "aria-required": required,
              "aria-describedby": describedBy,
              className: `${(children.props as any).className || ""} ${
                error
                  ? "border-[var(--cs-err)] focus:ring-[var(--cs-err)]"
                  : "border-[var(--cs-border)] focus:ring-[var(--cs-accent)]"
              } focus:outline-none focus:ring-2 rounded px-3 py-2 text-sm w-full border bg-[var(--cs-bg)] text-[var(--cs-text)] disabled:opacity-50 disabled:cursor-not-allowed`
            })
          : children}
      </div>

      {helperText && !error && (
        <p id={helperId} className="mt-1 text-xs text-[var(--cs-text-muted)]">
          {helperText}
        </p>
      )}

      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-1 text-xs font-medium text-[var(--cs-err)] flex items-center gap-1"
        >
          <span aria-hidden="true">⚠</span>
          {error}
        </p>
      )}
    </div>
  );
};

export interface FormErrorItem {
  fieldId?: string;
  message: string;
}

export interface FormErrorSummaryProps {
  errors: (string | FormErrorItem)[];
  title?: string;
  className?: string;
}

export const FormErrorSummary: React.FC<FormErrorSummaryProps> = ({
  errors,
  title = "There are errors that require your attention",
  className = ""
}) => {
  if (!errors || errors.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`cs-form-error-summary mb-6 rounded border border-[var(--cs-err)] bg-[var(--cs-err-bg)] p-4 ${className}`}
    >
      <h2 className="text-sm font-semibold text-[var(--cs-err)] flex items-center gap-2">
        <span aria-hidden="true">⚠</span>
        {title}
      </h2>
      <ul className="mt-2 list-disc list-inside text-sm text-[var(--cs-err)] space-y-1">
        {errors.map((err, index) => {
          const isItem = typeof err !== "string";
          const message = isItem ? err.message : err;
          const fieldId = isItem ? err.fieldId : undefined;

          return (
            <li key={index}>
              {fieldId ? (
                <a
                  href={`#${fieldId}`}
                  className="underline hover:text-black font-medium focus:outline-none focus:ring-2 focus:ring-[var(--cs-err)]"
                >
                  {message}
                </a>
              ) : (
                <span>{message}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
