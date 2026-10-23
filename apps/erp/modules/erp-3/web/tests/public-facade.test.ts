import { describe, it, expect } from 'vitest';
import * as erp3Web from '../src/index.js';

describe('ERP-3 web public facade', () => {
  it('exports all routing and shell components', () => {
    expect(erp3Web.erp3Routes).toBeDefined();
    expect(erp3Web.ERP3_BASE_PATH).toBe('/erp3');
    expect(erp3Web.ERP3_MODULE_LABEL).toBe('Sales Orders & Invoices');
    expect(erp3Web.ERP3_ROUTE_DESCRIPTORS).toBeDefined();
    expect(erp3Web.ModuleShell).toBeDefined();
    expect(erp3Web.ModuleNav).toBeDefined();
    expect(erp3Web.ModuleBreadcrumbs).toBeDefined();
    expect(erp3Web.RequireAuth).toBeDefined();
    expect(erp3Web.getSession).toBeDefined();
    expect(erp3Web.SalesOrdersListPage).toBeDefined();
    expect(erp3Web.InvoicesListPage).toBeDefined();
    expect(erp3Web.PaymentsListPage).toBeDefined();
    expect(erp3Web.SalesOrderCreatePage).toBeDefined();
    expect(erp3Web.SalesOrderDetailPage).toBeDefined();
    expect(erp3Web.SalesOrderEditPage).toBeDefined();
    expect(erp3Web.InvoiceCreateRoutePage).toBeDefined();
    expect(erp3Web.InvoiceDetailRoutePage).toBeDefined();
    expect(erp3Web.InvoiceEditRoutePage).toBeDefined();
    expect(erp3Web.ModuleNotFoundPage).toBeDefined();
  });

  it('preserves existing component and api exports', () => {
    expect(erp3Web.OrdersListPage).toBeDefined();
    expect(erp3Web.OrderCreatePage).toBeDefined();
    expect(erp3Web.OrderDetailPage).toBeDefined();
    expect(erp3Web.InvoiceCreatePage).toBeDefined();
    expect(erp3Web.InvoiceDetailPage).toBeDefined();
    expect(erp3Web.OrdersTable).toBeDefined();
    expect(erp3Web.InvoicesTable).toBeDefined();
    expect(erp3Web.fetchSalesOrders).toBeDefined();
    expect(erp3Web.fetchInvoices).toBeDefined();
    expect(erp3Web.fetchPayments).toBeDefined();
  });
});
