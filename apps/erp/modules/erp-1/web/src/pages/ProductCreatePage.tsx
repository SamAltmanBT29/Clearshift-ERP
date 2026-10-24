/**
 * ERP-1 Products & Inventory — Product Create Page
 *
 * @module erp1/web/pages/ProductCreatePage
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ProductCreateModal } from '../components/ProductCreateModal.js';
import { ERP1_BASE_PATH } from '../route-manifest.js';

export const ProductCreatePage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="cs-erp1-page" data-testid="product-create-page">
      <ProductCreateModal
        isOpen={true}
        onClose={() => navigate(`${ERP1_BASE_PATH}/products`)}
        onProductCreated={() => navigate(`${ERP1_BASE_PATH}/products`)}
      />
    </div>
  );
};

export default ProductCreatePage;
