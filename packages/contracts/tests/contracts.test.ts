import { describe, it, expect } from 'vitest';
import { CurrencyCode } from '../src/index.js';

describe('Contracts Smoke Test', () => {
  it('exports currency code contract validator', () => {
    expect(CurrencyCode.safeParse('USD').success).toBe(true);
    expect(CurrencyCode.safeParse('INVALID').success).toBe(false);
  });
});
