import React, { useState } from 'react';
import type { CreateInvoiceInput, Invoice, SalesOrder } from '@clearshift/contracts';
import { createInvoice } from '../api/erp-3.js';
import { InvoiceForm } from '../components/forms/InvoiceForm.js';

export interface InvoiceCreatePageProps {
  initialOrderId?: string;
  initialOrder?: SalesOrder | null;
  onBack: () => void;
  onInvoiceCreated: (invoice: Invoice) => void;
}

export const InvoiceCreatePage: React.FC<InvoiceCreatePageProps> = ({
  initialOrderId = '',
  initialOrder = null,
  onBack,
  onInvoiceCreated,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const handleSubmit = async (data: CreateInvoiceInput) => {
    setIsLoading(true);
    setApiError(null);
    try {
      const invoice = await createInvoice(data);
      onInvoiceCreated(invoice);
    } catch (err: any) {
      setApiError(err?.message || 'Failed to create invoice on the server.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="cs-module-root">
      <nav className="cs-back-nav" aria-label="Invoice creation navigation">
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
        <h1 className="cs-page-title">Generate Billing Invoice</h1>
        <p className="cs-page-description">
          Generate an invoice associated with a sales order. V1 mandates a required due date (DR-2)
          for automated overdue status derivation.
        </p>
      </header>

      <main>
        <InvoiceForm
          initialValues={{ order_id: initialOrderId || initialOrder?.id || '' }}
          sourceOrder={initialOrder}
          onSubmit={handleSubmit}
          onCancel={onBack}
          isLoading={isLoading}
          apiError={apiError}
        />
      </main>
    </div>
  );
};
