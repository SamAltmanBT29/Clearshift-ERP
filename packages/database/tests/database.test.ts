import { describe, it, expect } from 'vitest';
import { hubUsers, audit, withTransaction } from '../src/index.js';

describe('Database Smoke Test', () => {
  it('exports platform schema models and transaction helper', () => {
    expect(hubUsers).toBeDefined();
    expect(audit).toBeDefined();
    expect(withTransaction).toBeTypeOf('function');
  });
});
