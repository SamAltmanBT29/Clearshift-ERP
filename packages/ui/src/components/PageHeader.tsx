import React from "react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  isCurrent?: boolean;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ items, className = "" }) => {
  return (
    <nav aria-label="Breadcrumb" className={`cs-breadcrumb ${className}`}>
      <ol className="flex items-center space-x-2 text-sm text-[var(--cs-text-muted)]">
        {items.map((item, index) => {
          const isLast = index === items.length - 1 || item.isCurrent;
          return (
            <li key={index} className="flex items-center">
              {index > 0 && (
                <span className="mx-2 text-[var(--cs-border)]" aria-hidden="true">
                  /
                </span>
              )}
              {isLast ? (
                <span
                  className="font-medium text-[var(--cs-text)]"
                  aria-current="page"
                >
                  {item.label}
                </span>
              ) : item.href ? (
                <a
                  href={item.href}
                  className="hover:text-[var(--cs-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)] rounded"
                >
                  {item.label}
                </a>
              ) : (
                <span>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export interface PageTitleProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  breadcrumb?: BreadcrumbItem[];
  className?: string;
}

export const PageTitle: React.FC<PageTitleProps> = ({
  title,
  subtitle,
  actions,
  breadcrumb,
  className = ""
}) => {
  return (
    <header className={`cs-page-title mb-6 ${className}`}>
      {breadcrumb && breadcrumb.length > 0 && (
        <div className="mb-2">
          <Breadcrumb items={breadcrumb} />
        </div>
      )}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--cs-text)]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm text-[var(--cs-text-muted)]">
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
};
