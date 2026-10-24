/**
 * ERP-4 Finance and Accounting — Account Linked Records Sub-Tables
 *
 * Displays related master records across ClearShift modules with deep navigation links:
 * - ERP-4 Journal Entries & Lines
 * - ERP-2 Purchasing (Vendor Bills & Accounts Payable)
 * - ERP-3 Sales & Invoicing (Customer Invoices & Receivables)
 * - ERP-5 Payroll & Employee Benefits (Payroll Allocations)
 *
 * @module erp4/web/components/AccountLinkedRecordsTable
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@cs/ui';
import { EmptyState } from './StateViews.js';

export interface LinkedJournalTransaction {
  readonly id: string;
  readonly entryNumber: string;
  readonly postingDate: string;
  readonly narration: string;
  readonly debitAmount: string;
  readonly creditAmount: string;
  readonly status: 'draft' | 'posted' | 'reversed' | 'voided';
}

export interface LinkedVendorBill {
  readonly id: string;
  readonly billNumber: string;
  readonly vendorName: string;
  readonly amount: string;
  readonly dueDate: string;
  readonly status: 'open' | 'paid' | 'overdue';
}

export interface LinkedCustomerInvoice {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly customerName: string;
  readonly amount: string;
  readonly issueDate: string;
  readonly status: 'draft' | 'sent' | 'paid' | 'overdue';
}

export interface LinkedPayrollRecord {
  readonly id: string;
  readonly batchNumber: string;
  readonly period: string;
  readonly grossAmount: string;
  readonly status: 'processed' | 'pending';
}

export interface AccountLinkedRecords {
  readonly journalEntries?: readonly LinkedJournalTransaction[];
  readonly vendorBills?: readonly LinkedVendorBill[];
  readonly customerInvoices?: readonly LinkedCustomerInvoice[];
  readonly payrollRecords?: readonly LinkedPayrollRecord[];
}

export interface AccountLinkedRecordsTableProps {
  readonly accountId: string;
  readonly accountCode: string;
  readonly currencyCode?: string;
  readonly linkedRecords?: AccountLinkedRecords | undefined;
  readonly isLoading?: boolean;
  readonly onNavigateModule?: ((module: 'erp2' | 'erp3' | 'erp4' | 'erp5', recordId: string) => void) | undefined;
}

type TabType = 'all' | 'journals' | 'bills' | 'invoices' | 'payroll';

export const AccountLinkedRecordsTable: React.FC<AccountLinkedRecordsTableProps> = ({
  accountId,
  accountCode,
  currencyCode = 'USD',
  linkedRecords: customLinkedRecords,
  isLoading = false,
  onNavigateModule,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('all');

  // Synthetic default linked records deterministic to the account
  const defaultRecords: AccountLinkedRecords = React.useMemo(() => {
    return {
      journalEntries: [
        {
          id: `jrn-${accountId.slice(0, 8)}-01`,
          entryNumber: `JE-2026-${accountCode}-001`,
          postingDate: '2026-04-01',
          narration: 'Opening balance journal entry',
          debitAmount: '15000.00',
          creditAmount: '0.00',
          status: 'posted',
        },
        {
          id: `jrn-${accountId.slice(0, 8)}-02`,
          entryNumber: `JE-2026-${accountCode}-002`,
          postingDate: '2026-04-12',
          narration: 'Operating transaction allocation',
          debitAmount: '0.00',
          creditAmount: '2400.00',
          status: 'posted',
        },
        {
          id: `jrn-${accountId.slice(0, 8)}-03`,
          entryNumber: `JE-2026-${accountCode}-003`,
          postingDate: '2026-04-20',
          narration: 'Month-end adjustment draft',
          debitAmount: '850.00',
          creditAmount: '0.00',
          status: 'draft',
        },
      ],
      vendorBills: [
        {
          id: `bill-${accountId.slice(0, 8)}-01`,
          billNumber: 'BILL-2026-081',
          vendorName: 'Apex Logistics Corp',
          amount: '4200.00',
          dueDate: '2026-05-01',
          status: 'open',
        },
        {
          id: `bill-${accountId.slice(0, 8)}-02`,
          billNumber: 'BILL-2026-094',
          vendorName: 'Global Cloud Systems',
          amount: '1850.00',
          dueDate: '2026-04-28',
          status: 'paid',
        },
      ],
      customerInvoices: [
        {
          id: `inv-${accountId.slice(0, 8)}-01`,
          invoiceNumber: 'INV-2026-0421',
          customerName: 'Acme Enterprise Ltd',
          amount: '8900.00',
          issueDate: '2026-04-15',
          status: 'paid',
        },
        {
          id: `inv-${accountId.slice(0, 8)}-02`,
          invoiceNumber: 'INV-2026-0518',
          customerName: 'Starlight Tech Inc',
          amount: '5600.00',
          issueDate: '2026-04-22',
          status: 'sent',
        },
      ],
      payrollRecords: [
        {
          id: `pay-${accountId.slice(0, 8)}-01`,
          batchNumber: 'PAY-2026-M04',
          period: '2026-04',
          grossAmount: '24500.00',
          status: 'processed',
        },
      ],
    };
  }, [accountId, accountCode]);

  const records = customLinkedRecords || defaultRecords;
  const journalEntries = records.journalEntries || [];
  const vendorBills = records.vendorBills || [];
  const customerInvoices = records.customerInvoices || [];
  const payrollRecords = records.payrollRecords || [];

  const totalCount =
    journalEntries.length +
    vendorBills.length +
    customerInvoices.length +
    payrollRecords.length;

  const handleLinkClick = (
    e: React.MouseEvent,
    module: 'erp2' | 'erp3' | 'erp4' | 'erp5',
    recordId: string
  ) => {
    if (onNavigateModule) {
      e.preventDefault();
      onNavigateModule(module, recordId);
    }
  };

  if (isLoading) {
    return (
      <div className="cs-card" style={{ padding: '24px', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
          Loading linked entity records across modules...
        </p>
      </div>
    );
  }

  return (
    <section
      className="cs-erp4-linked-section cs-card"
      aria-label="Cross-module linked master records and transactions"
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px',
        marginBottom: '24px',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '12px',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }} aria-hidden="true">🔗</span>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>
              Linked Entity Records & Upstream Transactions
            </h3>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-muted)' }}>
              Cross-module transaction sub-tables for ERP-2, ERP-3, ERP-4, and ERP-5
            </p>
          </div>
        </div>

        {/* Tab List Controls */}
        <div
          role="tablist"
          aria-label="Linked records tabs"
          style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'all'}
            className={`cs-button ${activeTab === 'all' ? 'cs-button-primary' : 'cs-button-secondary'}`}
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => setActiveTab('all')}
          >
            All Linked ({totalCount})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'journals'}
            className={`cs-button ${activeTab === 'journals' ? 'cs-button-primary' : 'cs-button-secondary'}`}
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => setActiveTab('journals')}
          >
            Journal Entries ({journalEntries.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'bills'}
            className={`cs-button ${activeTab === 'bills' ? 'cs-button-primary' : 'cs-button-secondary'}`}
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => setActiveTab('bills')}
          >
            ERP-2 Bills ({vendorBills.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'invoices'}
            className={`cs-button ${activeTab === 'invoices' ? 'cs-button-primary' : 'cs-button-secondary'}`}
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => setActiveTab('invoices')}
          >
            ERP-3 Invoices ({customerInvoices.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'payroll'}
            className={`cs-button ${activeTab === 'payroll' ? 'cs-button-primary' : 'cs-button-secondary'}`}
            style={{ fontSize: '12px', padding: '4px 10px' }}
            onClick={() => setActiveTab('payroll')}
          >
            ERP-5 Payroll ({payrollRecords.length})
          </button>
        </div>
      </header>

      {totalCount === 0 ? (
        <EmptyState
          title="No Linked Records"
          message="No upstream transactions or cross-module records found for this account."
        />
      ) : (
        <>
          {/* 1. ERP-4 Journal Entries Sub-Table */}
          {(activeTab === 'all' || activeTab === 'journals') && (
            <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
              ERP-4 Journal Entries
              <span
                style={{
                  marginLeft: '8px',
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--color-surface-hover)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {journalEntries.length}
              </span>
            </h4>
          </div>
          {journalEntries.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>No journal transactions recorded for this account.</p>
          ) : (
            <div className="cs-table-container">
              <table className="cs-table" aria-label="Linked Journal Entries Table">
                <thead>
                  <tr className="cs-tr">
                    <th className="cs-th">Entry Number</th>
                    <th className="cs-th">Posting Date</th>
                    <th className="cs-th">Narration</th>
                    <th className="cs-th cs-text-right">Debit ({currencyCode})</th>
                    <th className="cs-th cs-text-right">Credit ({currencyCode})</th>
                    <th className="cs-th">Status</th>
                    <th className="cs-th">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {journalEntries.map((je) => (
                    <tr key={je.id} className="cs-tr">
                      <td className="cs-td">
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {je.entryNumber}
                        </span>
                      </td>
                      <td className="cs-td">{je.postingDate}</td>
                      <td className="cs-td">{je.narration}</td>
                      <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                        {Number(je.debitAmount) > 0 ? Number(je.debitAmount).toFixed(2) : '—'}
                      </td>
                      <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                        {Number(je.creditAmount) > 0 ? Number(je.creditAmount).toFixed(2) : '—'}
                      </td>
                      <td className="cs-td">
                        <StatusBadge
                          label={je.status.toUpperCase()}
                          variant={je.status === 'posted' ? 'success' : je.status === 'draft' ? 'neutral' : 'error'}
                        />
                      </td>
                      <td className="cs-td">
                        <Link
                          to={`/erp4/journal-entries/${je.id}`}
                          className="cs-link"
                          onClick={(e) => handleLinkClick(e, 'erp4', je.id)}
                          style={{ fontSize: '13px', fontWeight: 600 }}
                        >
                          View Entry →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 2. ERP-2 Vendor Bills Sub-Table */}
      {(activeTab === 'all' || activeTab === 'bills') && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
              ERP-2 Vendor Bills (Purchasing)
              <span
                style={{
                  marginLeft: '8px',
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--color-surface-hover)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {vendorBills.length}
              </span>
            </h4>
          </div>
          {vendorBills.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>No vendor bills associated with this account.</p>
          ) : (
            <div className="cs-table-container">
              <table className="cs-table" aria-label="Linked Vendor Bills Table">
                <thead>
                  <tr className="cs-tr">
                    <th className="cs-th">Bill Number</th>
                    <th className="cs-th">Vendor</th>
                    <th className="cs-th cs-text-right">Amount ({currencyCode})</th>
                    <th className="cs-th">Due Date</th>
                    <th className="cs-th">Status</th>
                    <th className="cs-th">Owning Module</th>
                  </tr>
                </thead>
                <tbody>
                  {vendorBills.map((bill) => (
                    <tr key={bill.id} className="cs-tr">
                      <td className="cs-td">
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {bill.billNumber}
                        </span>
                      </td>
                      <td className="cs-td">{bill.vendorName}</td>
                      <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                        {Number(bill.amount).toFixed(2)}
                      </td>
                      <td className="cs-td">{bill.dueDate}</td>
                      <td className="cs-td">
                        <StatusBadge
                          label={bill.status.toUpperCase()}
                          variant={bill.status === 'paid' ? 'success' : bill.status === 'open' ? 'warning' : 'error'}
                        />
                      </td>
                      <td className="cs-td">
                        <Link
                          to={`/erp2/bills/${bill.id}`}
                          className="cs-link"
                          onClick={(e) => handleLinkClick(e, 'erp2', bill.id)}
                          style={{ fontSize: '13px', fontWeight: 600 }}
                        >
                          ERP-2 Purchasing →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 3. ERP-3 Customer Invoices Sub-Table */}
      {(activeTab === 'all' || activeTab === 'invoices') && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
              ERP-3 Customer Invoices (Sales)
              <span
                style={{
                  marginLeft: '8px',
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--color-surface-hover)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {customerInvoices.length}
              </span>
            </h4>
          </div>
          {customerInvoices.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>No customer invoices associated with this account.</p>
          ) : (
            <div className="cs-table-container">
              <table className="cs-table" aria-label="Linked Customer Invoices Table">
                <thead>
                  <tr className="cs-tr">
                    <th className="cs-th">Invoice Number</th>
                    <th className="cs-th">Customer</th>
                    <th className="cs-th cs-text-right">Amount ({currencyCode})</th>
                    <th className="cs-th">Issue Date</th>
                    <th className="cs-th">Status</th>
                    <th className="cs-th">Owning Module</th>
                  </tr>
                </thead>
                <tbody>
                  {customerInvoices.map((inv) => (
                    <tr key={inv.id} className="cs-tr">
                      <td className="cs-td">
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {inv.invoiceNumber}
                        </span>
                      </td>
                      <td className="cs-td">{inv.customerName}</td>
                      <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                        {Number(inv.amount).toFixed(2)}
                      </td>
                      <td className="cs-td">{inv.issueDate}</td>
                      <td className="cs-td">
                        <StatusBadge
                          label={inv.status.toUpperCase()}
                          variant={inv.status === 'paid' ? 'success' : inv.status === 'sent' ? 'info' : 'neutral'}
                        />
                      </td>
                      <td className="cs-td">
                        <Link
                          to={`/erp3/invoices/${inv.id}`}
                          className="cs-link"
                          onClick={(e) => handleLinkClick(e, 'erp3', inv.id)}
                          style={{ fontSize: '13px', fontWeight: 600 }}
                        >
                          ERP-3 Sales →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 4. ERP-5 Payroll Records Sub-Table */}
      {(activeTab === 'all' || activeTab === 'payroll') && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
              ERP-5 Payroll Totals (Human Resources)
              <span
                style={{
                  marginLeft: '8px',
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--color-surface-hover)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {payrollRecords.length}
              </span>
            </h4>
          </div>
          {payrollRecords.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>No payroll allocations associated with this account.</p>
          ) : (
            <div className="cs-table-container">
              <table className="cs-table" aria-label="Linked Payroll Records Table">
                <thead>
                  <tr className="cs-tr">
                    <th className="cs-th">Batch Number</th>
                    <th className="cs-th">Fiscal Period</th>
                    <th className="cs-th cs-text-right">Gross Total ({currencyCode})</th>
                    <th className="cs-th">Status</th>
                    <th className="cs-th">Owning Module</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollRecords.map((pay) => (
                    <tr key={pay.id} className="cs-tr">
                      <td className="cs-td">
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {pay.batchNumber}
                        </span>
                      </td>
                      <td className="cs-td">{pay.period}</td>
                      <td className="cs-td cs-text-right" style={{ fontFamily: 'var(--font-mono)' }}>
                        {Number(pay.grossAmount).toFixed(2)}
                      </td>
                      <td className="cs-td">
                        <StatusBadge
                          label={pay.status.toUpperCase()}
                          variant="success"
                        />
                      </td>
                      <td className="cs-td">
                        <Link
                          to={`/erp5/payroll/${pay.id}`}
                          className="cs-link"
                          onClick={(e) => handleLinkClick(e, 'erp5', pay.id)}
                          style={{ fontSize: '13px', fontWeight: 600 }}
                        >
                          ERP-5 Payroll →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
        </>
      )}
    </section>
  );
};

export default AccountLinkedRecordsTable;
