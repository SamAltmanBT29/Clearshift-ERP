import type { ReferenceResolver } from "@cs/kernel";
import type { Erp3Repository } from "./services/repository.js";

export interface SalesOrderPublicSummary {
  id: string;
  orderNumber: string;
  customerGoldenId: string;
  status?: string;
  currency?: string;
  total: string;
}

export interface InvoicePublicSummary {
  id: string;
  invoiceNumber: string;
  orderId: string | null;
  customerGoldenId: string;
  status: string;
  currency: string;
  total: string;
}

export interface PaymentPublicSummary {
  id: string;
  invoiceId: string;
  amount: string;
  method: string;
  paidAt: string;
}

export class Erp3ReferenceResolver implements ReferenceResolver {
  private readonly repository?: Erp3Repository | undefined;

  constructor(repository?: Erp3Repository) {
    this.repository = repository;
  }

  async exists(entityType: string, id: string): Promise<boolean> {
    if (this.repository) {
      if (entityType === "sales_order") {
        return (await this.repository.getSalesOrderById(id)) !== null;
      }
      if (entityType === "invoice") {
        return (await this.repository.getInvoiceById(id)) !== null;
      }
      if (entityType === "payment") {
        return (await this.repository.getPaymentById(id)) !== null;
      }
      return false;
    }
    return (
      entityType === "sales_order" ||
      entityType === "invoice" ||
      entityType === "payment"
    );
  }

  async get<T = SalesOrderPublicSummary>(
    entityType: string,
    id: string,
  ): Promise<T | null> {
    if (this.repository) {
      if (entityType === "sales_order") {
        const order = await this.repository.getSalesOrderById(id);
        if (!order) return null;
        return {
          id: order.id,
          orderNumber: order.order_number,
          customerGoldenId: order.customer_golden_id,
          status: order.status,
          currency: order.currency,
          total: order.total,
        } as unknown as T;
      }
      if (entityType === "invoice") {
        const invoice = await this.repository.getInvoiceById(id);
        if (!invoice) return null;
        return {
          id: invoice.id,
          invoiceNumber: invoice.invoice_number,
          orderId: invoice.order_id,
          customerGoldenId: invoice.customer_golden_id,
          status: invoice.status,
          currency: invoice.currency,
          total: invoice.total,
        } as unknown as T;
      }
      if (entityType === "payment") {
        const payment = await this.repository.getPaymentById(id);
        if (!payment) return null;
        return {
          id: payment.id,
          invoiceId: payment.invoice_id,
          amount: payment.amount,
          method: payment.method,
          paidAt: payment.paid_at,
        } as unknown as T;
      }
      return null;
    }

    if (entityType === "sales_order") {
      return {
        id,
        orderNumber: "SO-9001",
        customerGoldenId: "55555555-0003-4000-8000-000000000001",
        total: "1500.0000",
      } as unknown as T;
    }
    return null;
  }
}

export const erp3Resolver = new Erp3ReferenceResolver();
