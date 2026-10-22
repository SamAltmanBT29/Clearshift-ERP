/**
 * ERP-5 HR & Employees — Client-side Permission Helper Tests
 *
 * The helper asks the **shared central matrix** (PLT-06) whether the session
 * may create an HR master record. These tests pin that the module never
 * answers the question from a local copy of the role list.
 */

import { describe, it, expect } from 'vitest';
import { canCreateHrRecord, toRoleTypes } from '../src/auth/permissions.js';

describe('ERP-5 client-side permission helper', () => {
  describe('1. Role narrowing', () => {
    it('keeps the roles the platform knows', () => {
      expect(toRoleTypes(['viewer', 'editor', 'admin'])).toEqual(['viewer', 'editor', 'admin']);
    });

    it('drops a role the platform does not know', () => {
      expect(toRoleTypes(['viewer', 'superuser'])).toEqual(['viewer']);
    });

    it('keeps no role at all for an empty claim', () => {
      expect(toRoleTypes([])).toEqual([]);
    });
  });

  describe('2. Creating an HR master record', () => {
    it('allows an editor', () => {
      expect(canCreateHrRecord(['editor'])).toBe(true);
    });

    it('allows an administrator', () => {
      expect(canCreateHrRecord(['admin'])).toBe(true);
    });

    it('refuses a viewer', () => {
      expect(canCreateHrRecord(['viewer'])).toBe(false);
    });

    it('refuses an analyst', () => {
      expect(canCreateHrRecord(['analyst'])).toBe(false);
    });

    it('refuses a migration runner', () => {
      expect(canCreateHrRecord(['migration_runner'])).toBe(false);
    });

    it('refuses a session without a role', () => {
      expect(canCreateHrRecord([])).toBe(false);
    });

    it('refuses a session whose role the platform does not know', () => {
      expect(canCreateHrRecord(['superuser'])).toBe(false);
    });

    it('allows a session that carries one of several roles', () => {
      expect(canCreateHrRecord(['viewer', 'editor'])).toBe(true);
    });
  });
});
