/**
 * @file tests/contracts/fixtures.ts
 * Synthetic test fixtures, user role tokens, and checksum manifest for QA-02 conformance suite.
 *
 * Constraints (Non-Negotiable):
 * - 100% synthetic fixtures; zero real personal, corporate, or financial data.
 * - Generates SHA-256 fixture checksums for audit traceability.
 */

import { createHash } from 'node:crypto';
import { Roles, RoleType } from '@clearshift/contracts';

export interface TestUser {
  id: string;
  name: string;
  email: string;
  roles: RoleType[];
}

export const SYNTHETIC_USERS: Record<string, TestUser> = {
  viewer: {
    id: '00000000-0000-4000-a000-000000000001',
    name: 'Synthetic Viewer User',
    email: 'viewer.synthetic@clearshift.test',
    roles: [Roles.VIEWER],
  },
  editor: {
    id: '00000000-0000-4000-a000-000000000002',
    name: 'Synthetic Editor User',
    email: 'editor.synthetic@clearshift.test',
    roles: [Roles.EDITOR],
  },
  migration_runner: {
    id: '00000000-0000-4000-a000-000000000003',
    name: 'Synthetic Runner User',
    email: 'runner.synthetic@clearshift.test',
    roles: [Roles.MIGRATION_RUNNER],
  },
  analyst: {
    id: '00000000-0000-4000-a000-000000000004',
    name: 'Synthetic Analyst User',
    email: 'analyst.synthetic@clearshift.test',
    roles: [Roles.ANALYST],
  },
  admin: {
    id: '00000000-0000-4000-a000-000000000005',
    name: 'Synthetic Admin User',
    email: 'admin.synthetic@clearshift.test',
    roles: [Roles.ADMIN],
  },
};

/**
 * Standard Synthetic Headers for each role with deterministic correlation IDs.
 */
export function getRoleHeaders(role: keyof typeof SYNTHETIC_USERS | 'anonymous', correlationId?: string): Record<string, string> {
  const corr = correlationId || `corr-qa02-${Date.now()}`;
  if (role === 'anonymous') {
    return {
      'x-correlation-id': corr,
      'content-type': 'application/json',
      accept: 'application/json',
    };
  }

  const user = SYNTHETIC_USERS[role];
  return {
    authorization: `Bearer token-${user.roles[0]}`,
    'x-user-id': user.id,
    'x-user-roles': user.roles.join(','),
    'x-correlation-id': corr,
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

/**
 * Synthetic Domain Entity Fixtures (All UUIDs and data are strictly synthetic).
 */
export const SYNTHETIC_FIXTURES = {
  erp1: {
    product: {
      name: 'Synthetic Industrial Bolt M8',
      sku: 'SYN-BOLT-M8-001',
      unitOfMeasure: 'pcs',
      price: '4.5000',
      currency: 'USD',
      taxRate: '18.00',
    },
    category: {
      code: 'SYN-FASTENERS',
      name: 'Synthetic Fasteners & Hardware',
      description: 'Synthetic category for testing',
    },
    openingStock: {
      quantity: '500.0000',
      idempotency_key: 'idem-syn-stock-001',
    },
  },
  erp2: {
    vendor: {
      name: 'Synthetic Global Supplier Ltd',
      code: 'VEND-SYN-001',
      currency: 'USD',
      payment_terms: 'NET_30',
      bank_account_number: 'GB29NWBK60161331926819',
      tax_id: 'US-987654321',
    },
    purchaseOrder: {
      vendor_id: '00000000-0000-4000-b000-000000000001',
      order_date: '2026-10-24',
      currency: 'USD',
      items: [
        {
          product_id: '00000000-0000-4000-b000-000000000010',
          sku: 'SYN-BOLT-M8-001',
          quantity: 100,
          unit_price: '4.50',
          tax_rate: '0.18',
        },
      ],
    },
  },
  erp3: {
    salesOrder: {
      customer_golden_id: '55555555-0003-4000-8000-000000000001',
      order_date: '2026-10-24',
      currency: 'USD',
      lines: [
        {
          product_id: '11111111-0001-4000-8000-000000000001',
          quantity: '10.0000',
          price: '25.0000',
          tax_rate: '10.0000',
        },
      ],
    },
    invoice: {
      order_id: '33333333-0003-4000-8000-000000000001',
      due_date: '2026-11-24',
      currency: 'USD',
    },
    payment: {
      invoice_id: '44444444-0003-4000-8000-000000000001',
      amount: '275.0000',
      payment_method: 'card',
    },
  },
  erp4: {
    account: {
      account_number: '1010-SYN',
      name: 'Synthetic Operating Cash',
      type: 'ASSET',
      currency: 'USD',
    },
    journalEntry: {
      entry_number: 'JE-SYN-001',
      date: '2026-10-24',
      memo: 'Synthetic balanced entry for contract conformance',
      lines: [
        { account_number: '1010-SYN', debit: '1000.00', credit: '0.00' },
        { account_number: '2010-SYN', debit: '0.00', credit: '1000.00' },
      ],
    },
  },
  erp5: {
    employee: {
      first_name: 'Synthetic',
      last_name: 'Tester',
      email: 'synthetic.tester@clearshift.test',
      department_code: 'ENG',
      role: 'Staff Quality Engineer',
      salary: 125000,
      ssn: '987-65-4321',
      bank_account_number: '123456789012',
    },
    department: {
      code: 'ENG',
      name: 'Engineering & QA',
      cost_center: 'CC-ENG-01',
    },
  },
  migrationKit: {
    batchPayload: {
      source_system: 'ERP-LEGACY-SAP',
      target_module: 'erp-1',
      record_count: 1000,
      checksum_md5: 'd41d8cd98f00b204e9800998ecf8427e',
    },
  },
};

/**
 * Calculates SHA-256 checksum of an object or string for audit traceability.
 */
export function calculateChecksum(data: unknown): string {
  const content = typeof data === 'string' ? data : JSON.stringify(data);
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Returns audit manifest containing runtime environment and checksums.
 */
export function getAuditManifest() {
  return {
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    fixtures_checksum_sha256: calculateChecksum(SYNTHETIC_FIXTURES),
    users_checksum_sha256: calculateChecksum(SYNTHETIC_USERS),
  };
}
