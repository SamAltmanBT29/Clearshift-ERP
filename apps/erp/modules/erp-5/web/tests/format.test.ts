/**
 * ERP-5 HR & Employees — Display Formatting Tests
 *
 * The formatting helpers must never lose a digit: a payroll amount is
 * grouped as a string, never converted to a number, and an identifier is
 * shortened for display only.
 */

import { describe, it, expect } from 'vitest';
import {
  EMPTY_VALUE,
  formatAmount,
  formatOptional,
  shortIdentifier,
} from '../src/utils/format.js';

describe('ERP-5 display formatting', () => {
  describe('1. Amounts', () => {
    it('groups the thousands of a whole amount', () => {
      expect(formatAmount('125000')).toBe('125,000');
      expect(formatAmount('1000000')).toBe('1,000,000');
    });

    it('drops a fraction that is only zeros', () => {
      expect(formatAmount('125000.0000')).toBe('125,000');
      expect(formatAmount('125000.00')).toBe('125,000');
    });

    it('keeps a fraction that carries a value', () => {
      expect(formatAmount('125000.5000')).toBe('125,000.5');
      expect(formatAmount('125000.25')).toBe('125,000.25');
    });

    it('keeps a small amount readable', () => {
      expect(formatAmount('0')).toBe('0');
      expect(formatAmount('999')).toBe('999');
    });

    it('never rounds — the value is a string', () => {
      expect(formatAmount('12345678901234.5678')).toBe('12,345,678,901,234.5678');
    });
  });

  describe('2. Identifiers', () => {
    it('shortens a long identifier for display', () => {
      expect(shortIdentifier('e1000000-0000-4000-8000-000000000001')).toBe('e1000000…');
    });

    it('leaves a short identifier alone', () => {
      expect(shortIdentifier('EMP-0001')).toBe('EMP-0001');
    });
  });

  describe('3. Absent values', () => {
    it('renders an absent value as an em dash', () => {
      expect(formatOptional(null)).toBe(EMPTY_VALUE);
      expect(formatOptional(undefined)).toBe(EMPTY_VALUE);
      expect(formatOptional('')).toBe(EMPTY_VALUE);
    });

    it('keeps a value that is present', () => {
      expect(formatOptional('active')).toBe('active');
    });
  });
});
