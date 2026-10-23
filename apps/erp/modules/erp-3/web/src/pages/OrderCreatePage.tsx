import React, { useState } from 'react';
import type { CreateSalesOrderInput, SalesOrder } from '@clearshift/contracts';
import { createSalesOrder } from '../api/erp-3.js';
import { OrderForm } from '../components/forms/OrderForm.js';

export interface OrderCreatePageProps {
  onBack: () => void;
  onOrderCreated: (order: SalesOrder) => void;
}

export const OrderCreatePage: React.FC<OrderCreatePageProps> = ({ onBack, onOrderCreated }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const handleSubmit = async (data: CreateSalesOrderInput) => {
    setIsLoading(true);
    setApiError(null);
    try {
      const order = await createSalesOrder(data);
      onOrderCreated(order);
    } catch (err: any) {
      setApiError(err?.message || 'Failed to create sales order on the server.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="cs-module-root">
      <nav className="cs-back-nav" aria-label="Order creation navigation">
        <button
          type="button"
          className="cs-btn-back"
          onClick={onBack}
          aria-label="Back to Sales Orders & Invoices list"
        >
          ← Back to Sales Orders & Invoices
        </button>
      </nav>

      <header className="cs-page-header">
        <h1 className="cs-page-title">New Sales Order</h1>
        <p className="cs-page-description">
          Enter customer Golden ID, select currency, and configure dynamic product line items.
          Subtotals and taxes calculate live according to domain rule BR-ERP3-02.
        </p>
      </header>

      <div className="cs-form-content">
        <OrderForm
          onSubmit={handleSubmit}
          onCancel={onBack}
          isLoading={isLoading}
          apiError={apiError}
        />
      </div>
    </div>
  );
};
