import { describe, it, expect } from 'vitest';
import { detectExactDuplicates } from '../../src/profile/duplicate-detector.js';

describe('DuplicateDetector (KIT-03)', () => {
  it('detects exact duplicate keys and reports row numbers', () => {
    const rows = [
      { sourceRow: 1, payload: { email: 'alice@example.com', name: 'Alice 1' } },
      { sourceRow: 2, payload: { email: 'bob@example.com', name: 'Bob' } },
      { sourceRow: 3, payload: { email: 'alice@example.com', name: 'Alice 2' } },
      { sourceRow: 4, payload: { email: 'carol@example.com', name: 'Carol' } },
      { sourceRow: 5, payload: { email: 'ALICE@EXAMPLE.COM', name: 'Alice 3' } },
    ];

    const result = detectExactDuplicates(rows, { keyFields: ['email'] });
    expect(result.report.totalDuplicates).toBe(3); // Rows 1, 3, 5 are all in duplicate group
    expect(result.report.uniqueDuplicateKeys).toBe(1);
    expect(result.report.sampleDuplicateKeys).toContain('alice@example.com');
    expect(result.duplicateRowIndices).toEqual([1, 3, 5]);
  });

  it('supports composite duplicate key matching across multiple columns', () => {
    const rows = [
      { sourceRow: 1, payload: { company: 'Acme', country: 'US' } },
      { sourceRow: 2, payload: { company: 'Acme', country: 'UK' } },
      { sourceRow: 3, payload: { company: 'Acme', country: 'US' } },
      { sourceRow: 4, payload: { company: 'Beta', country: 'US' } },
    ];

    const result = detectExactDuplicates(rows, { keyFields: ['company', 'country'] });
    expect(result.report.totalDuplicates).toBe(2);
    expect(result.duplicateRowIndices).toEqual([1, 3]);
  });

  it('ignores rows where key is completely blank', () => {
    const rows = [
      { sourceRow: 1, payload: { email: '' } },
      { sourceRow: 2, payload: { email: '   ' } },
      { sourceRow: 3, payload: { email: 'valid@example.com' } },
    ];

    const result = detectExactDuplicates(rows, { keyFields: ['email'] });
    expect(result.report.totalDuplicates).toBe(0);
    expect(result.report.uniqueDuplicateKeys).toBe(0);
  });
});
