import React from 'react';
import type { Account } from '@clearshift/contracts';
import { StatusBadge } from '../StateViews.js';

export interface EditableJournalLine {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  lineNarration: string;
  debitAmount: string;
  creditAmount: string;
  error?: string;
}

interface JournalLinesEditorProps {
  lines: EditableJournalLine[];
  accounts: Account[];
  currencyCode: string;
  readOnly?: boolean;
  onChange: (updatedLines: EditableJournalLine[]) => void;
  onOpenCreateAccount?: () => void;
}

export const JournalLinesEditor: React.FC<JournalLinesEditorProps> = ({
  lines,
  accounts,
  currencyCode,
  readOnly = false,
  onChange,
  onOpenCreateAccount,
}) => {
  const handleLineChange = (
    index: number,
    field: keyof EditableJournalLine,
    value: string
  ) => {
    if (readOnly) return;
    const updated = [...lines];
    const current = updated[index];
    if (!current) return;

    if (field === 'accountId') {
      const selectedAcc = accounts.find((a) => a.id === value);
      updated[index] = {
        ...current,
        accountId: value,
        accountCode: selectedAcc?.code || '',
        accountName: selectedAcc?.name || '',
      };
    } else if (field === 'debitAmount') {
      // If debit is typed, clear credit if it was non-zero (enforces mutual exclusivity)
      const numVal = parseFloat(value) || 0;
      updated[index] = {
        ...current,
        debitAmount: value,
        creditAmount: numVal > 0 ? '0.00' : current.creditAmount,
        error: undefined,
      };
    } else if (field === 'creditAmount') {
      // If credit is typed, clear debit if it was non-zero (enforces mutual exclusivity)
      const numVal = parseFloat(value) || 0;
      updated[index] = {
        ...current,
        creditAmount: value,
        debitAmount: numVal > 0 ? '0.00' : current.debitAmount,
        error: undefined,
      };
    } else {
      updated[index] = {
        ...current,
        [field]: value,
      };
    }

    onChange(updated);
  };

  const handleAddLine = () => {
    if (readOnly) return;
    const newLine: EditableJournalLine = {
      id: `line-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      accountId: accounts[0]?.id || '',
      accountCode: accounts[0]?.code || '',
      accountName: accounts[0]?.name || '',
      lineNarration: '',
      debitAmount: '0.00',
      creditAmount: '0.00',
    };
    onChange([...lines, newLine]);
  };

  const handleRemoveLine = (index: number) => {
    if (readOnly || lines.length <= 2) return;
    const updated = lines.filter((_, i) => i !== index);
    onChange(updated);
  };

  // Live debit vs credit balance calculation
  const totalDebit = lines.reduce((sum, l) => sum + (parseFloat(l.debitAmount) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (parseFloat(l.creditAmount) || 0), 0);
  const roundedDebit = Math.round(totalDebit * 100) / 100;
  const roundedCredit = Math.round(totalCredit * 100) / 100;
  const difference = Math.round(Math.abs(roundedDebit - roundedCredit) * 100) / 100;
  const isBalanced = difference === 0 && roundedDebit > 0 && lines.length >= 2;

  return (
    <div className="cs-lines-editor" role="region" aria-label="Journal entry line items">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
          Journal Lines ({lines.length} items)
        </h3>
        {!readOnly && (
          <div style={{ display: 'flex', gap: '8px' }}>
            {onOpenCreateAccount && (
              <button
                type="button"
                className="cs-btn cs-btn-secondary cs-btn-sm"
                onClick={onOpenCreateAccount}
                aria-label="Create new account"
              >
                + New Account
              </button>
            )}
            <button
              type="button"
              className="cs-btn cs-btn-secondary cs-btn-sm"
              onClick={handleAddLine}
              aria-label="Add journal line"
            >
              + Add Line
            </button>
          </div>
        )}
      </div>

      <div className="cs-table-container">
        <table className="cs-table" aria-label="Journal Entry Lines Table">
          <thead>
            <tr className="cs-tr">
              <th className="cs-th" style={{ width: '30%' }}>Account</th>
              <th className="cs-th" style={{ width: '30%' }}>Line Narration</th>
              <th className="cs-th cs-text-right" style={{ width: '18%' }}>Debit ({currencyCode})</th>
              <th className="cs-th cs-text-right" style={{ width: '18%' }}>Credit ({currencyCode})</th>
              {!readOnly && <th className="cs-th" style={{ width: '4%' }}>Action</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => {
              const dVal = parseFloat(line.debitAmount) || 0;
              const cVal = parseFloat(line.creditAmount) || 0;
              const hasMutualError = dVal > 0 && cVal > 0;
              const hasZeroError = dVal === 0 && cVal === 0;

              return (
                <tr key={line.id} className="cs-tr">
                  <td className="cs-td">
                    {readOnly ? (
                      <div>
                        <span className="cs-code">{line.accountCode}</span> — {line.accountName}
                      </div>
                    ) : (
                      <select
                        className="cs-select"
                        style={{ width: '100%' }}
                        value={line.accountId}
                        onChange={(e) => handleLineChange(idx, 'accountId', e.target.value)}
                        aria-label={`Account for line ${idx + 1}`}
                      >
                        {accounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            [{acc.code}] {acc.name} ({acc.type})
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="cs-td">
                    {readOnly ? (
                      <span style={{ color: line.lineNarration ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                        {line.lineNarration || '—'}
                      </span>
                    ) : (
                      <input
                        type="text"
                        className="cs-input"
                        style={{ width: '100%' }}
                        placeholder="Narration / description memo"
                        value={line.lineNarration}
                        onChange={(e) => handleLineChange(idx, 'lineNarration', e.target.value)}
                        aria-label={`Narration for line ${idx + 1}`}
                      />
                    )}
                  </td>
                  <td className="cs-td cs-text-right">
                    {readOnly ? (
                      <span style={{ fontFamily: 'var(--font-mono)' }}>
                        {dVal > 0 ? dVal.toFixed(2) : '—'}
                      </span>
                    ) : (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className={`cs-input ${hasMutualError ? 'cs-input-error' : ''}`}
                        style={{ width: '100%', textAlign: 'right', fontFamily: 'var(--font-mono)' }}
                        value={line.debitAmount}
                        onChange={(e) => handleLineChange(idx, 'debitAmount', e.target.value)}
                        aria-label={`Debit amount for line ${idx + 1}`}
                      />
                    )}
                  </td>
                  <td className="cs-td cs-text-right">
                    {readOnly ? (
                      <span style={{ fontFamily: 'var(--font-mono)' }}>
                        {cVal > 0 ? cVal.toFixed(2) : '—'}
                      </span>
                    ) : (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className={`cs-input ${hasMutualError ? 'cs-input-error' : ''}`}
                        style={{ width: '100%', textAlign: 'right', fontFamily: 'var(--font-mono)' }}
                        value={line.creditAmount}
                        onChange={(e) => handleLineChange(idx, 'creditAmount', e.target.value)}
                        aria-label={`Credit amount for line ${idx + 1}`}
                      />
                    )}
                  </td>
                  {!readOnly && (
                    <td className="cs-td">
                      <button
                        type="button"
                        className="cs-btn cs-btn-danger cs-btn-sm"
                        onClick={() => handleRemoveLine(idx)}
                        disabled={lines.length <= 2}
                        aria-label={`Remove line ${idx + 1}`}
                        title={lines.length <= 2 ? 'Minimum 2 lines required' : 'Delete line'}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 🔴 Live Debit vs. Credit Balance Checker Widget */}
      <div className="cs-live-balance-box" role="status" aria-label="Live balance check">
        <div className="cs-live-balance-metrics">
          <div className="cs-live-balance-metric">
            <span className="cs-live-balance-label">Total Debits</span>
            <span className="cs-live-balance-value" style={{ color: 'var(--color-primary)' }}>
              {currencyCode} {roundedDebit.toFixed(2)}
            </span>
          </div>
          <div className="cs-live-balance-metric">
            <span className="cs-live-balance-label">Total Credits</span>
            <span className="cs-live-balance-value" style={{ color: 'var(--color-primary)' }}>
              {currencyCode} {roundedCredit.toFixed(2)}
            </span>
          </div>
          <div className="cs-live-balance-metric">
            <span className="cs-live-balance-label">Variance (Difference)</span>
            <span
              className="cs-live-balance-value"
              style={{ color: difference === 0 ? 'var(--color-success)' : 'var(--color-error)' }}
            >
              {currencyCode} {difference.toFixed(2)}
            </span>
          </div>
        </div>

        <div>
          {lines.length < 2 ? (
            <StatusBadge label="⚠️ At least 2 lines required" variant="expense" />
          ) : isBalanced ? (
            <StatusBadge label="✓ Invariant Verified: Balanced" variant="success" />
          ) : (
            <StatusBadge
              label={`✗ Unbalanced: ${currencyCode} ${difference.toFixed(2)} variance`}
              variant="error"
            />
          )}
        </div>
      </div>
    </div>
  );
};
