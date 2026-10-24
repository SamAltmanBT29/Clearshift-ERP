/**
 * ERP-5 HR & Employees — Identity Users List Screen
 *
 * The read-only Hub Identity projection on the real API
 * (`GET /api/v1/erp-hr/identity-users`).
 *
 * The screen is read-only by design: the Hub owns credentials and roles,
 * and the projection carries no credential, hash or token column. The
 * collection is empty when the platform has not created the projection yet —
 * that is a valid state, not a failure.
 *
 * @module erp5/web/pages/IdentityUsersListPage
 */

import React, { useMemo, useState } from 'react';
import { PageTitle, Pagination } from '@cs/ui';
import { useSearchParams } from 'react-router-dom';
import {
  HR_PAGE_SIZE_DEFAULT,
  HR_PAGE_SIZE_MAX,
  type HrIdentityUser,
  type HrIdentityUserListQuery,
} from '@clearshift/contracts';
import { listIdentityUsers } from '../api/erp-5.js';
import { IdentityUsersTable } from '../components/IdentityUsersTable.js';
import { ListFilterBar } from '../components/ListFilterBar.js';
import { ListStateBoundary } from '../components/ListStateBoundary.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useHrList } from '../hooks/useHrList.js';

export const IdentityUsersListPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(() => {
    const p = Number(searchParams.get('page'));
    return Number.isFinite(p) && p >= 1 ? p : 1;
  });
  const [pageSize, setPageSize] = useState(() => {
    const p = Number(searchParams.get('pageSize'));
    return Number.isFinite(p) && p >= 1 && p <= HR_PAGE_SIZE_MAX ? p : HR_PAGE_SIZE_DEFAULT;
  });
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');

  const debouncedSearch = useDebouncedValue(search);

  const query = useMemo<HrIdentityUserListQuery>(
    () => ({
      page,
      pageSize,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }),
    [page, pageSize, debouncedSearch]
  );

  React.useEffect(() => {
    const params = new URLSearchParams();
    if (page !== 1) params.set('page', String(page));
    if (pageSize !== HR_PAGE_SIZE_DEFAULT) params.set('pageSize', String(pageSize));
    if (search.trim()) params.set('search', search.trim());
    setSearchParams(params, { replace: true });
  }, [page, pageSize, search, setSearchParams]);

  const { items, meta, isLoading, error, reload } = useHrList<
    HrIdentityUser,
    HrIdentityUserListQuery
  >((currentQuery, signal) => listIdentityUsers(currentQuery, { signal }), query);

  const hasFilters = search.trim().length > 0;

  const handleReset = () => {
    setSearch('');
    setPage(1);
  };

  return (
    <div className="cs-erp5-list-page">
      <PageTitle
        title="Identity users"
        subtitle="A read-only projection of the Hub Identity accounts — usernames, roles and status."
      />

      <ListFilterBar
        landmarkLabel="Search and filter identity users"
        searchLabel="Search identity users"
        searchPlaceholder="Username"
        searchHelperText="Searches the username on the server."
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        onReset={handleReset}
        resetLabel="Clear filters"
        isLoading={isLoading}
        activeFilters={
          search.trim()
            ? [{ id: 'search', label: `Search: ${search.trim()}`, onRemove: () => { setSearch(''); setPage(1); } }]
            : []
        }
      />

      <ListStateBoundary
        isLoading={isLoading}
        error={error}
        isEmpty={items.length === 0}
        onRetry={reload}
        errorTitle="Unable to load the identity users"
        emptyTitle="No identity users found"
        emptyMessage={
          hasFilters
            ? 'No identity user matches the current search.'
            : 'The Hub Identity projection is empty. It exists only once the platform has created the projection.'
        }
        {...(hasFilters ? { emptyActionLabel: 'Clear filters', onEmptyAction: handleReset } : {})}
        skeletonColumns={4}
        skeletonRows={6}
      >
        <IdentityUsersTable identityUsers={items} />
      </ListStateBoundary>

      {meta ? (
        <Pagination
          currentPage={meta.page}
          totalPages={Math.max(meta.totalPages, 1)}
          totalItems={meta.total}
          pageSize={meta.pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          isLoading={isLoading}
        />
      ) : null}
    </div>
  );
};

export default IdentityUsersListPage;
