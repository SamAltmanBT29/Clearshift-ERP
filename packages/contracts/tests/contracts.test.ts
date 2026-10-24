import { describe, it, expect } from 'vitest';
import { CurrencyCode } from '../src/index.js';

describe('Contracts Smoke Test', () => {
  it('exports currency code contract validator', () => {
    expect(CurrencyCode.safeParse('USD').success).toBe(true);
    expect(CurrencyCode.safeParse('INVALID').success).toBe(false);
  });

  it('exports ERP-2 vendor and purchase order schemas', async () => {
    const contracts = await import('../src/index.js');
    expect(contracts.VendorSchema).toBeDefined();
    expect(contracts.CreateVendorRequestSchema).toBeDefined();
    expect(contracts.PurchaseOrderSchema).toBeDefined();
    expect(contracts.CreatePurchaseOrderRequestSchema).toBeDefined();
    expect(contracts.MaskedBankSchema.safeParse('XXXX-XXXX-7890').success).toBe(true);
    expect(contracts.MaskedBankSchema.safeParse('1234567890').success).toBe(false);
  });
});
