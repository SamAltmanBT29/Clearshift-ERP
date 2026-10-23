/**
 * ERP-5 HR & Employees — Identity Users Table
 *
 * The read-only Hub Identity projection (Master Architecture Spec C3).
 *
 * The projection carries **no credential, hash or token column** — the
 * screen can therefore never show one, and it offers no write action: the
 * Hub owns identities and roles, the HR module only reads them.
 *
 * @module erp5/web/components/IdentityUsersTable
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge, Table, type ColumnDef } from '@cs/ui';
import type { HrIdentityUser } from '@clearshift/contracts';
import { formatOptional, shortIdentifier } from '../utils/format.js';

export interface IdentityUsersTableProps {
  readonly identityUsers: readonly HrIdentityUser[];
  readonly isLoading?: boolean | undefined;
}

export const IdentityUsersTable: React.FC<IdentityUsersTableProps> = ({
  identityUsers,
  isLoading = false,
}) => {
  const columns: ColumnDef<HrIdentityUser>[] = [
    { key: 'username', header: 'Username' },
    {
      key: 'roles',
      header: 'Roles',
      render: (row) =>
        row.roles.length > 0 ? row.roles.join(', ') : formatOptional(null),
    },
    {
      key: 'employee_ref',
      header: 'Linked employee',
      render: (row) =>
        row.employee_ref ? (
          <Link
            className="cs-erp5-row-link"
            to={`/erp5/employees/${row.employee_ref}`}
            title={row.employee_ref}
            aria-label={`View linked employee ${row.employee_ref}`}
          >
            {shortIdentifier(row.employee_ref)}
          </Link>
        ) : (
          formatOptional(null)
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusBadge
          label={row.status.toUpperCase()}
          variant={row.status.toLowerCase() === 'active' ? 'success' : 'neutral'}
        />
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      data={identityUsers as HrIdentityUser[]}
      caption="Identity users"
      emptyMessage="No identity user to show."
      keyExtractor={(row) => row.id}
      isLoading={isLoading}
    />
  );
};

export default IdentityUsersTable;
