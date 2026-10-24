/**
 * ERP-1 Products & Inventory — 404 Not Found Page
 *
 * @module erp1/web/pages/ModuleNotFoundPage
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ERP1_BASE_PATH } from '../route-manifest.js';

export const ModuleNotFoundPage: React.FC = () => {
  return (
    <div className="cs-erp1-page cs-erp1-not-found" data-testid="module-not-found-page">
      <header className="cs-erp1-page-header">
        <h1 className="cs-erp1-page-title">Page Not Found</h1>
        <p className="cs-erp1-page-subtitle">The requested ERP-1 screen does not exist.</p>
      </header>
      <div className="cs-erp1-card">
        <p>Please check the URL or return to the products catalog.</p>
        <Link to={`${ERP1_BASE_PATH}/products`} className="cs-erp1-btn cs-erp1-btn-primary">
          Back to Products
        </Link>
      </div>
    </div>
  );
};

export default ModuleNotFoundPage;
