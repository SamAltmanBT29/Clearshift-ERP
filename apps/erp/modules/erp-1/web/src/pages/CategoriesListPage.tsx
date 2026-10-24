/**
 * ERP-1 Products & Inventory — Categories Page
 *
 * @module erp1/web/pages/CategoriesListPage
 */

import React from 'react';

export const CategoriesListPage: React.FC = () => {
  return (
    <div className="cs-erp1-page" data-testid="categories-list-page">
      <header className="cs-erp1-page-header">
        <h1 className="cs-erp1-page-title">Categories</h1>
        <p className="cs-erp1-page-subtitle">One-level product categories for catalog organization</p>
      </header>
      <div className="cs-erp1-card">
        <p>Categories master management</p>
      </div>
    </div>
  );
};

export default CategoriesListPage;
