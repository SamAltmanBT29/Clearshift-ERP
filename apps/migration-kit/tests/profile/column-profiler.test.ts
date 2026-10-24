import { describe, it, expect } from 'vitest';
import {
  profileColumn,
  inferColumnType,
  isValidForType,
} from '../../src/profile/column-profiler.js';

describe('ColumnProfiler (KIT-03)', () => {
  describe('Type Inference & Validation', () => {
    it('infers uuid type when majority of non-empty values are UUIDs', () => {
      const values = [
        'c1000000-0000-4000-8000-000000000001',
        'c1000000-0000-4000-8000-000000000002',
        '',
        'c1000000-0000-4000-8000-000000000003',
      ];
      expect(inferColumnType(values)).toBe('uuid');
    });

    it('infers email type and flags invalid emails', () => {
      const values = ['alice@example.com', 'bob@test.org', 'invalid_email', 'carol@domain.co'];
      expect(inferColumnType(values)).toBe('email');
      expect(isValidForType('alice@example.com', 'email')).toBe(true);
      expect(isValidForType('invalid_email', 'email')).toBe(false);
    });

    it('infers phone type and flags invalid phones', () => {
      const values = ['+1-555-0100', '+44 20 7946 0958', 'BAD_PHONE', '+49 30 123456'];
      expect(inferColumnType(values)).toBe('phone');
      expect(isValidForType('+1-555-0100', 'phone')).toBe(true);
      expect(isValidForType('BAD_PHONE', 'phone')).toBe(false);
    });

    it('infers integer and decimal types', () => {
      expect(inferColumnType(['10', '20', '300', '4000'])).toBe('integer');
      expect(inferColumnType(['10.5', '20.99', '300.0', '4000'])).toBe('decimal');
    });

    it('infers date type for ISO dates', () => {
      expect(inferColumnType(['2026-10-19T00:00:00.000Z', '2026-10-20', '2026-10-21T12:30:00Z'])).toBe('date');
    });

    it('infers boolean type', () => {
      expect(inferColumnType(['true', 'false', 'true', 'true'])).toBe('boolean');
    });
  });

  describe('Column Profiling Metrics', () => {
    it('accurately counts empties, distinct values, and invalid formats', () => {
      const values = [
        'user1@example.com',
        '',
        '   ',
        'user2@example.com',
        'invalid_format_email',
        'user1@example.com',
      ];

      const profile = profileColumn('email', values);
      expect(profile.columnName).toBe('email');
      expect(profile.totalRows).toBe(6);
      expect(profile.emptyCount).toBe(2);
      expect(profile.distinctCount).toBe(3); // 'user1@example.com', 'user2@example.com', 'invalid_format_email'
      expect(profile.invalidCount).toBe(1); // 'invalid_format_email'
      expect(profile.inferredType).toBe('email');
    });

    it('computes top 5 values sorted by frequency desc, with deterministic tie-breaking', () => {
      const values = [
        'A', 'A', 'A',
        'B', 'B',
        'C', 'C',
        'D',
        'E',
        'F',
      ];

      const profile = profileColumn('category', values);
      expect(profile.topValues).toHaveLength(5);
      expect(profile.topValues[0]).toEqual({ value: 'A', count: 3, percentage: 30 });
      // B and C both have count 2; B comes before C alphabetically
      expect(profile.topValues[1]).toEqual({ value: 'B', count: 2, percentage: 20 });
      expect(profile.topValues[2]).toEqual({ value: 'C', count: 2, percentage: 20 });
    });

    it('computes min and max values', () => {
      const values = ['banana', 'apple', 'cherry', 'date'];
      const profile = profileColumn('fruit', values);
      expect(profile.minValue).toBe('apple');
      expect(profile.maxValue).toBe('date');
    });
  });
});
