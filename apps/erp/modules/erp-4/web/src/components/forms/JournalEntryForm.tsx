import React, { useState } from 'react';
import type { Account, JournalEntry } from '@clearshift/contracts';
import { JournalLinesEditor, type EditableJournalLine } from './JournalLinesEditor.js';
import { createJournalEntry, postJournalEntry, isJournalEntryBalanced, fetchPeriods } from '../../api/erp-4.js';

interface JournalEntryFormProps {
  accounts: Account[];
  initialCurrency?: string;
  onSuccess: (entry: JournalEntry, action: 'draft' | 'posted') => void;
  onCancel: () => void;
  onOpenCreateAccount?: () => void;
}

export const JournalEntryForm: React.FC<JournalEntryFormProps> = ({
  accounts,
  initialCurrency = 'USD',
  onSuccess,
  onCancel,
  onOpenCreateAccount,
}) => {
  const today = new Date().toISOString().split('T')[0] || '';
  const currentPeriod = today.substring(0, 7);

  // Form State
  const [postingDate, setPostingDate] = useState(today);
  const [period, setPeriod] = useState(currentPeriod);
  const [periods, setPeriods] = useState<any[]>([]);

  React.useEffect(() => {
    fetchPeriods().then((res) => {
      if (res.items && res.items.length > 0) {
        setPeriods(res.items);
        const open = res.items.find((p: any) => p.status === 'open') || res.items[0];
        if (open?.id) {
          setPeriod(open.id);
        }
      }
    }).catch(() => {
      // ignore
    });
  }, []);
  const [description, setDescription] = useState('');
  const [currencyCode, setCurrencyCode] = useState(initialCurrency);
  const [sourceReference, setSourceReference] = useState('');

  // Initial 2 lines for balanced double-entry
  const [lines, setLines] = useState<EditableJournalLine[]>(() => {
    const acc1 = accounts[0];
    const acc2 = accounts[1] || accounts[0];
    return [
      {
        id: 'line-1',
        accountId: acc1?.id || '',
        accountCode: acc1?.code || '1010',
        accountName: acc1?.name || 'Cash',
        lineNarration: '',
        debitAmount: '0.00',
        creditAmount: '0.00',
      },
      {
        id: 'line-2',
        accountId: acc2?.id || '',
        accountCode: acc2?.code || '2010',
        accountName: acc2?.name || 'Accounts Payable',
        lineNarration: '',
        debitAmount: '0.00',
        creditAmount: '0.00',
      },
    ];
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Validate form fields client-side before sending to server
  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!postingDate) {
      errs['postingDate'] = 'Posting date is required';
    }

    if (!period) {
      errs['period'] = 'Accounting period is required';
    }

    if (!description.trim()) {
      errs['description'] = 'Journal entry description is required';
    } else if (description.trim().length < 3) {
      errs['description'] = 'Description must be at least 3 characters';
    }

    if (lines.length < 2) {
      errs['lines'] = 'A double-entry journal entry requires at least 2 lines';
    }

    // Assert each line has an account and only one of debit/credit
    let hasLineError = false;
    const lineChecks = lines.map((l) => {
      const d = parseFloat(l.debitAmount) || 0;
      const c = parseFloat(l.creditAmount) || 0;
      return { debit: d, credit: c };
    });

    lines.forEach((l, idx) => {
      const d = parseFloat(l.debitAmount) || 0;
      const c = parseFloat(l.creditAmount) || 0;
      if (d <= 0 && c <= 0) {
        errs[`line_${idx}`] = `Line ${idx + 1} must have a positive debit or credit`;
        hasLineError = true;
      } else if (d > 0 && c > 0) {
        errs[`line_${idx}`] = `Line ${idx + 1} cannot have both positive debit and credit`;
        hasLineError = true;
      }
    });

    // Enforce BR-ERP4-01: Double-entry balancing invariant
    if (!hasLineError && !isJournalEntryBalanced(lineChecks)) {
      errs['balance'] = 'Total debits must exactly equal total credits (Double-Entry Invariant BR-ERP4-01)';
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setApiError(null);
    try {
      const payload = {
        posting_date: postingDate,
        period_id: period, // accepts period string or UUID
        description: description.trim(),
        currency_code: currencyCode,
        source_reference: sourceReference.trim() || null,
        lines: lines.map((l) => ({
          account_id: l.accountId,
          debit_amount: (parseFloat(l.debitAmount) || 0).toFixed(4),
          credit_amount: (parseFloat(l.creditAmount) || 0).toFixed(4),
          line_narration: l.lineNarration.trim() || null,
        })),
      };

      const created = await createJournalEntry(payload);
      onSuccess(created, 'draft');
    } catch (err: any) {
      // Acceptance criteria: API errors presented without losing form state
      setApiError(err?.message || 'Server rejected journal entry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePostImmediately = async () => {
    if (!validate()) return;

    // Irreversible action confirmation
    const confirmed = window.confirm(
      'Are you sure you want to permanently POST this journal entry? Once posted, journal entries are locked and immutable per BR-ERP4-04.'
    );
    if (!confirmed) return;

    setIsSubmitting(true);
    setApiError(null);
    try {
      const payload = {
        posting_date: postingDate,
        period_id: period,
        description: description.trim(),
        currency_code: currencyCode,
        source_reference: sourceReference.trim() || null,
        lines: lines.map((l) => ({
          account_id: l.accountId,
          debit_amount: (parseFloat(l.debitAmount) || 0).toFixed(4),
          credit_amount: (parseFloat(l.creditAmount) || 0).toFixed(4),
          line_narration: l.lineNarration.trim() || null,
        })),
      };

      const created = await createJournalEntry(payload);
      const posted = await postJournalEntry(created.id);
      onSuccess(posted, 'posted');
    } catch (err: any) {
      setApiError(err?.message || 'Failed to post journal entry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="cs-form-container" onSubmit={handleSaveDraft} noValidate aria-label="Create Journal Entry Form">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
            New Journal Entry
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--color-text-muted)', margin: '4px 0 0 0' }}>
            Build and record balanced general ledger transactions.
          </p>
        </div>
        <button
          type="button"
          className="cs-btn cs-btn-secondary cs-btn-sm"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          ← Cancel & Back to List
        </button>
      </div>

      {apiError && (
        <div
          role="alert"
          style={{
            padding: '12px 16px',
            background: 'var(--color-error-bg)',
            border: '1px solid var(--color-error-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-error)',
            marginBottom: '20px',
            fontSize: '14px',
          }}
        >
          <strong>API Validation Error:</strong> {apiError}
        </div>
      )}

      {fieldErrors['balance'] && (
        <div
          role="alert"
          style={{
            padding: '10px 14px',
            background: 'var(--color-error-bg)',
            border: '1px solid var(--color-error-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-error)',
            marginBottom: '16px',
            fontSize: '13px',
          }}
        >
          {fieldErrors['balance']}
        </div>
      )}

      {/* Header Fields Grid */}
      <div className="cs-form-grid">
        <div className="cs-form-group">
          <label htmlFor="je-date" className="cs-form-label cs-form-label-required">
            Posting Date
          </label>
          <input
            id="je-date"
            type="date"
            className={`cs-input ${fieldErrors['postingDate'] ? 'cs-input-error' : ''}`}
            value={postingDate}
            onChange={(e) => {
              setPostingDate(e.target.value);
              if (e.target.value) setPeriod(e.target.value.substring(0, 7));
            }}
            disabled={isSubmitting}
            aria-describedby={fieldErrors['postingDate'] ? 'postingDate-err' : undefined}
          />
          {fieldErrors['postingDate'] && (
            <span id="postingDate-err" className="cs-form-error">{fieldErrors['postingDate']}</span>
          )}
        </div>

        <div className="cs-form-group">
          <label htmlFor="je-period" className="cs-form-label cs-form-label-required">
            Fiscal Period
          </label>
          {periods.length > 0 ? (
            <select
              id="je-period"
              className={`cs-select ${fieldErrors['period'] ? 'cs-input-error' : ''}`}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              disabled={isSubmitting}
              aria-describedby={fieldErrors['period'] ? 'period-err' : undefined}
            >
              {periods.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.period_label || p.label || p.id} ({p.status})
                </option>
              ))}
            </select>
          ) : (
            <input
              id="je-period"
              type="text"
              className={`cs-input ${fieldErrors['period'] ? 'cs-input-error' : ''}`}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              disabled={isSubmitting}
              aria-describedby={fieldErrors['period'] ? 'period-err' : undefined}
            />
          )}
          {fieldErrors['period'] && (
            <span id="period-err" className="cs-form-error">{fieldErrors['period']}</span>
          )}
          <span className="cs-form-helper">Closed periods strictly reject posting</span>
        </div>

        <div className="cs-form-group">
          <label htmlFor="je-currency" className="cs-form-label cs-form-label-required">
            Currency
          </label>
          <select
            id="je-currency"
            className="cs-select"
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.target.value)}
            disabled={isSubmitting}
          >
            <option value="USD">USD — US Dollar</option>
            <option value="INR">INR — Indian Rupee</option>
            <option value="EUR">EUR — Euro</option>
            <option value="GBP">GBP — British Pound</option>
          </select>
          <span className="cs-form-helper">All lines inherit entry currency (no V1 FX conversion)</span>
        </div>

        <div className="cs-form-group">
          <label htmlFor="je-ref" className="cs-form-label">
            Source Reference
          </label>
          <input
            id="je-ref"
            type="text"
            className="cs-input"
            placeholder="e.g. PO-2026-091 or INV-449"
            value={sourceReference}
            onChange={(e) => setSourceReference(e.target.value)}
            disabled={isSubmitting}
          />
          <span className="cs-form-helper">External document tracking ID</span>
        </div>
      </div>

      <div className="cs-form-group" style={{ marginBottom: '24px' }}>
        <label htmlFor="je-desc" className="cs-form-label cs-form-label-required">
          Transaction Description / Memo
        </label>
        <input
          id="je-desc"
          type="text"
          className={`cs-input ${fieldErrors['description'] ? 'cs-input-error' : ''}`}
          placeholder="e.g. Monthly server infrastructure charge and operational cash payment"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isSubmitting}
          aria-describedby={fieldErrors['description'] ? 'desc-err' : undefined}
        />
        {fieldErrors['description'] && (
          <span id="desc-err" className="cs-form-error">{fieldErrors['description']}</span>
        )}
      </div>

      {/* Embedded Lines Editor with Live Debit vs Credit Balance Checker */}
      <JournalLinesEditor
        lines={lines}
        accounts={accounts}
        currencyCode={currencyCode}
        onChange={setLines}
        onOpenCreateAccount={onOpenCreateAccount}
      />

      {/* Form Submission Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
        <button
          type="button"
          className="cs-btn cs-btn-secondary"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="cs-btn cs-btn-secondary"
          disabled={isSubmitting}
          aria-label="Save draft entry"
        >
          {isSubmitting ? 'Saving...' : '💾 Save as Draft'}
        </button>
        <button
          type="button"
          className="cs-btn cs-btn-primary"
          onClick={handlePostImmediately}
          disabled={isSubmitting}
          aria-label="Post journal entry immediately"
        >
          {isSubmitting ? 'Posting...' : '🔒 Post Entry (Lock)'}
        </button>
      </div>
    </form>
  );
};
