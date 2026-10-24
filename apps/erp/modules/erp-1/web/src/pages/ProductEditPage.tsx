/**
 * ERP-1 Products & Inventory — Product Edit Page
 *
 * @module erp1/web/pages/ProductEditPage
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ProductDetailPage } from './ProductDetailPage.js';

export const ProductEditPage: React.FC = () => {
  const { productId } = useParams<{ productId: string }>();

  return (
    <div className="cs-erp1-page" data-testid="product-edit-page">
      <ProductDetailPage productId={productId} />
    </div>
  );
};

export default ProductEditPage;
