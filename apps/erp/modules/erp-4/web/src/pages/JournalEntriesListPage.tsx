/**
 * ERP-4 Finance and Accounting — Journal Entries List Page
 *
 * Route: `/erp4/journal-entries`
 *
 * @module erp4/web/pages/JournalEntriesListPage
 */

import React, { useState, useEffect, useCallback } from 'react';
import { PageTitle, type SortDirection } from '@cs/ui';
import { Link } from 'react-router-dom';
import type { JournalEntry } from '@clearshift/contracts';
import { fetchJournalEntries } from '../api/erp-4.js';
import { ErrorState } from '../components/StateViews.js';
import { JournalEntriesTable } from '../components/JournalEntriesTable.js';

export const JournalEntriesListPage: React.FC = () => {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [sortColumn, setSortColumn] = useState<string>('posting_date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJournalEntries = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchJournalEntries({ page, limit: pageSize });
      setEntries(response.items || []);
      setTotal(response.total || 0);
      setTotalPages(response.totalPages || Math.max(1, Math.ceil((response.total || 0) / pageSize)));
    } catch (err: any) {
      setError(err?.message || 'Failed to load journal entries');
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    loadJournalEntries();
  }, [loadJournalEntries]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(1);
  };

  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  return (
    <div className="cs-page-container">
      <PageTitle
        title="Journal Entries"
        subtitle="Double-entry transaction ledger with immutable audit trail and balance enforcement"
        actions={
          <Link
            to="/erp4/journal-entries/new"
            className="cs-btn cs-btn-primary"
            role="button"
          >
            + New Journal Entry
          </Link>
        }
      />

      {error ? (
        <ErrorState
          title="Error Loading Journal Entries"
          message={error}
          onRetry={loadJournalEntries}
        />
      ) : (
        <JournalEntriesTable
          entries={entries}
          isLoading={isLoading}
          total={total}
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          onSort={handleSort}
          onRefresh={loadJournalEntries}
        />
      )}
    </div>
  );
};

export default JournalEntriesListPage;
