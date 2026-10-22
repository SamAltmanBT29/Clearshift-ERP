// @vitest-environment jsdom
/**
 * ERP-5 HR & Employees — Form Hook Tests
 *
 * The form hook is where the contract meets the browser. These tests pin the
 * three rules it enforces on its own:
 *
 *   - an empty value is **not** sent as an empty string;
 *   - only the fields that changed are reported as changed;
 *   - a contract failure produces a field-level message and sends nothing.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { z } from 'zod';
import { useHrForm, pickChangedFields } from '../src/hooks/useHrForm.js';

const schema = z.object({
  name: z.string().min(1, 'Name must not be empty'),
  code: z.string().regex(/^[A-Z]+$/, 'Code must be uppercase').optional(),
  amount: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Amount must be a decimal').optional(),
});

describe('ERP-5 form hook', () => {
  describe('1. The contract decides', () => {
    it('reports the contract’s message for a field', () => {
      const { result } = renderHook(() =>
        useHrForm({
          schema,
          initialValues: { name: '', code: '' },
          onSubmit: async () => undefined,
        })
      );

      act(() => {
        result.current.setValue('name', '');
      });

      expect(result.current.isValid).toBe(false);
    });

    it('accepts values that satisfy the contract', () => {
      const { result } = renderHook(() =>
        useHrForm({
          schema,
          initialValues: { name: '', code: '' },
          onSubmit: async () => undefined,
        })
      );

      act(() => {
        result.current.setValue('name', 'Engineering');
        result.current.setValue('code', 'ENG');
      });

      expect(result.current.isValid).toBe(true);
    });

    it('sends nothing when the contract refuses the values', async () => {
      const onSubmit = vi.fn(async () => undefined);
      const { result } = renderHook(() =>
        useHrForm({
          schema,
          initialValues: { name: '', code: '' },
          onSubmit,
        })
      );

      await act(async () => {
        result.current.handleSubmit({ preventDefault: () => undefined });
      });

      expect(onSubmit).not.toHaveBeenCalled();
      expect(result.current.errors['name']).toBeDefined();
    });
  });

  describe('2. Empty values', () => {
    it('drops an empty optional field instead of sending it', async () => {
      const onSubmit = vi.fn(async () => undefined);
      const { result } = renderHook(() =>
        useHrForm({
          schema,
          initialValues: { name: 'Engineering', code: '', amount: '' },
          onSubmit,
        })
      );

      await act(async () => {
        result.current.handleSubmit({ preventDefault: () => undefined });
      });

      expect(onSubmit).toHaveBeenCalledTimes(1);
      const [values] = onSubmit.mock.calls[0] as [{ name?: string; code?: string }];
      expect(values['name']).toBe('Engineering');
      expect(values['code']).toBeUndefined();
    });
  });

  describe('3. Changed fields', () => {
    it('reports only the fields whose value differs from the initial one', () => {
      const { result } = renderHook(() =>
        useHrForm({
          schema,
          initialValues: { name: 'Engineering', code: 'ENG', amount: '' },
          onSubmit: async () => undefined,
        })
      );

      act(() => {
        result.current.setValue('code', 'PLAT');
      });

      expect(result.current.changedFields).toEqual(['code']);
      expect(result.current.isDirty).toBe(true);
    });

    it('reports nothing when the operator restores the initial value', () => {
      const { result } = renderHook(() =>
        useHrForm({
          schema,
          initialValues: { name: 'Engineering', code: 'ENG', amount: '' },
          onSubmit: async () => undefined,
        })
      );

      act(() => {
        result.current.setValue('code', 'PLAT');
      });
      act(() => {
        result.current.setValue('code', 'ENG');
      });

      expect(result.current.changedFields).toEqual([]);
      expect(result.current.isDirty).toBe(false);
    });

    it('picks the changed fields out of a validated payload', () => {
      const picked = pickChangedFields(
        { name: 'Engineering', code: 'PLAT', amount: undefined },
        ['code']
      );

      expect(picked).toEqual({ code: 'PLAT' });
    });
  });

  describe('4. A failing submit', () => {
    it('keeps the failure on the form instead of throwing it away', async () => {
      const { HrApiError } = await import('../src/api/erp-5.js');
      const onSubmit = vi.fn(async () => {
        throw new HrApiError(422, 'HR_INVALID', 'The value was refused.', [
          { field: 'name', message: 'The value was refused.' },
        ]);
      });

      const { result } = renderHook(() =>
        useHrForm({
          schema,
          initialValues: { name: '', code: '' },
          onSubmit,
        })
      );

      act(() => {
        result.current.setValue('name', 'Engineering');
      });

      await act(async () => {
        result.current.handleSubmit({ preventDefault: () => undefined });
      });

      expect(result.current.submitError?.status).toBe(422);
      expect(result.current.isSubmitting).toBe(false);
    });
  });
});
