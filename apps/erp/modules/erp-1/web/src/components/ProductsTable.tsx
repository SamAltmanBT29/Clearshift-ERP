import React from 'react';
import type { Product, Category, ProductSortField } from '@clearshift/contracts';
import { StatusBadge, Pagination } from '@cs/ui';

export interface ProductWithStock extends Product {
  stockQuantity?: string;
}

export interface ProductsTableProps {
  readonly products: readonly ProductWithStock[];
  readonly categories: readonly Category[];
  readonly isLoading: boolean;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
  readonly sortBy?: ProductSortField;
  readonly sortDirection?: 'asc' | 'desc';
  readonly onSort?: (column: ProductSortField) => void;
}

function resolveStockStatus(quantityStr?: string): {
  label: string;
  variant: 'success' | 'warning' | 'error' | 'neutral';
} {
  if (quantityStr === undefined || quantityStr === null) {
    return { label: 'Unknown', variant: 'neutral' };
  }
  const qty = Number(quantityStr);
  if (isNaN(qty) || qty <= 0) {
    return { label: 'Out of Stock', variant: 'error' };
  }
  if (qty <= 10) {
    return { label: `Low (${qty})`, variant: 'warning' };
  }
  return { label: `In Stock (${qty})`, variant: 'success' };
}

export const ProductsTable: React.FC<ProductsTableProps> = ({
  products,
  categories,
  isLoading,
  total,
  page,
  pageSize,
  totalPages,
  onPageChange,
  sortBy,
  sortDirection = 'asc',
  onSort,
}) => {
  const categoryMap = React.useMemo(() => {
    const map = new Map<string, Category>();
    categories.forEach((cat) => map.set(cat.id, cat));
    return map;
  }, [categories]);

  const renderSortIndicator = (field: ProductSortField) => {
    if (sortBy !== field) {
      return (
        <span className="cs-erp1-sort-header-icon" aria-hidden="true">
          ⇅
        </span>
      );
    }
    return (
      <span className="cs-erp1-sort-header-icon active" aria-hidden="true">
        {sortDirection === 'asc' ? '▲' : '▼'}
      </span>
    );
  };

  const getAriaSort = (field: ProductSortField): 'ascending' | 'descending' | 'none' => {
    if (sortBy !== field) return 'none';
    return sortDirection === 'asc' ? 'ascending' : 'descending';
  };

  return (
    <div className="cs-erp1-table-wrapper">
      <div className="cs-erp1-table-responsive">
        <table
          className="cs-erp1-table"
          aria-label="Products catalog and inventory table"
          aria-busy={isLoading}
        >
          <caption className="cs-erp1-sr-only">
            Products list displaying SKU, Category, Unit, Price, Tax, and Inventory
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                aria-sort={getAriaSort('name')}
                className="cs-erp1-th-sortable"
                onClick={() => onSort && onSort('name')}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSort && onSort('name');
                  }
                }}
              >
                <div className="cs-erp1-th-content">
                  <span>Product Name</span>
                  {renderSortIndicator('name')}
                </div>
              </th>
              <th
                scope="col"
                aria-sort={getAriaSort('sku')}
                className="cs-erp1-th-sortable"
                onClick={() => onSort && onSort('sku')}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSort && onSort('sku');
                  }
                }}
              >
                <div className="cs-erp1-th-content">
                  <span>SKU</span>
                  {renderSortIndicator('sku')}
                </div>
              </th>
              <th scope="col">Category</th>
              <th scope="col">Unit</th>
              <th
                scope="col"
                aria-sort={getAriaSort('price')}
                className="cs-erp1-th-sortable cs-erp1-th-right"
                onClick={() => onSort && onSort('price')}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSort && onSort('price');
                  }
                }}
              >
                <div className="cs-erp1-th-content cs-erp1-content-right">
                  <span>Price</span>
                  {renderSortIndicator('price')}
                </div>
              </th>
              <th scope="col" className="cs-erp1-th-right">
                Tax Rate
              </th>
              <th
                scope="col"
                aria-sort={getAriaSort('quantity')}
                className="cs-erp1-th-sortable"
                onClick={() => onSort && onSort('quantity')}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSort && onSort('quantity');
                  }
                }}
              >
                <div className="cs-erp1-th-content">
                  <span>Stock Status</span>
                  {renderSortIndicator('quantity')}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={7} className="cs-erp1-empty-state-cell text-center py-8">
                  {isLoading ? 'Loading products...' : 'No records found matching search or filter'}
                </td>
              </tr>
            ) : (
              products.map((product) => {
                const category = product.categoryId ? categoryMap.get(product.categoryId) : null;
                const stock = resolveStockStatus(product.stockQuantity);
                const numPrice = Number(product.price);
                const formattedPrice = isNaN(numPrice)
                  ? product.price
                  : numPrice.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 4,
                    });

                return (
                  <tr key={product.id} className="cs-erp1-row">
                  <td className="cs-erp1-cell-primary">
                    <div className="cs-erp1-product-name">{product.name}</div>
                    {product.sourceSystem && (
                      <span className="cs-erp1-source-meta">
                        Source: {product.sourceSystem} #{product.sourceId}
                      </span>
                    )}
                  </td>
                  <td>
                    <code className="cs-erp1-sku-code">{product.sku}</code>
                  </td>
                  <td>
                    {category ? (
                      <span className="cs-erp1-category-badge" title={category.name}>
                        {category.name}
                      </span>
                    ) : (
                      <span className="cs-erp1-text-muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className="cs-erp1-unit-pill">{product.unitOfMeasure}</span>
                  </td>
                  <td className="cs-erp1-cell-right">
                    <span className="cs-erp1-price-amount">
                      {formattedPrice} {product.currency}
                    </span>
                  </td>
                  <td className="cs-erp1-cell-right">
                    <span className="cs-erp1-tax-rate">{product.taxRate}%</span>
                  </td>
                  <td>
                    <StatusBadge label={stock.label} variant={stock.variant} />
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          totalItems={total}
          pageSize={pageSize}
          onPageChange={onPageChange}
          isLoading={isLoading}
        />
      )}
    </div>
  );
};

export default ProductsTable;
