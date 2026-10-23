import React from 'react';
import { SkeletonTable, EmptyState, ErrorState } from '@cs/ui';

export interface EmptyProductsViewProps {
  readonly hasActiveFilters: boolean;
  readonly onClearFilters: () => void;
  readonly className?: string;
}

export const EmptyProductsView: React.FC<EmptyProductsViewProps> = ({
  hasActiveFilters,
  onClearFilters,
  className = '',
}) => {
  if (hasActiveFilters) {
    return (
      <EmptyState
        title="No matching products found"
        message="No products match the selected filters or search query. Try adjusting your search term or clearing active filters."
        actionLabel="Clear all filters"
        onAction={onClearFilters}
        className={className}
      />
    );
  }

  return (
    <EmptyState
      title="No products in catalog"
      message="No products have been recorded in the catalog yet."
      className={className}
    />
  );
};

export interface ErrorProductsViewProps {
  readonly message?: string;
  readonly onRetry: () => void;
  readonly className?: string;
}

export const ErrorProductsView: React.FC<ErrorProductsViewProps> = ({
  message = 'Failed to load products from server.',
  onRetry,
  className = '',
}) => {
  return (
    <ErrorState
      title="Unable to load products"
      message={message}
      onRetry={onRetry}
      retryLabel="Try Again"
      className={className}
    />
  );
};

export const ProductsLoadingSkeleton: React.FC = () => {
  return <SkeletonTable columns={7} rows={6} />;
};

export { SkeletonTable, EmptyState, ErrorState };
