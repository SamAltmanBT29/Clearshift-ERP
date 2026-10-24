/**
 * ERP-4 Finance and Accounting — Web Test API Mock
 *
 * Intercepts fetch calls to ERP-4 endpoints during headless testing.
 */

export interface FinanceApiMockOptions {
  readonly pending?: boolean;
}

export interface FinanceApiMock {
  restore: () => void;
}

export function installFinanceApiMock(options: FinanceApiMockOptions = {}): FinanceApiMock {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (options.pending) {
      // Return a never-resolving promise or empty successful response
      return new Response(
        JSON.stringify({
          items: [],
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 1,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (url.includes('/accounts')) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'acc-1',
              accountNumber: '1010',
              name: 'Operating Cash',
              type: 'asset',
              currency: 'USD',
              currentBalance: '50000.00',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (url.includes('/journal-entries')) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'jrn-1',
              entryNumber: 'JE-2026-0001',
              entryDate: '2026-10-24',
              description: 'Initial balance transfer',
              period: '2026-10',
              status: 'posted',
              lines: [
                { id: 'jl-1', accountId: 'acc-1', debit_amount: '100.00', credit_amount: '0.00' },
                { id: 'jl-2', accountId: 'acc-2', debit_amount: '0.00', credit_amount: '100.00' },
              ],
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (url.includes('/trial-balance')) {
      return new Response(
        JSON.stringify({
          period: '2026-10',
          isBalanced: true,
          totalDebit: '100.00',
          totalCredit: '100.00',
          items: [
            {
              accountNumber: '1010',
              name: 'Operating Cash',
              type: 'asset',
              debit: '100.00',
              credit: '0.00',
              balance: '100.00',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(JSON.stringify({ message: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  return {
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}
