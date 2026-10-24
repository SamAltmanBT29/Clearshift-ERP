import { describe, it, expect } from 'vitest';
import {
  canKitBatchTransition,
  assertValidKitBatchTransition,
  isKitBatchTerminalStatus,
  isKitBatchResumableStatus,
  getAllowedNextKitBatchStates,
  getValidResumeTarget,
  computeNextCheckpoint,
  resolveStepName,
  IllegalBatchStateTransitionError,
  verifyReconciliationCounts,
  KitBatchStatus,
} from '@clearshift/contracts';

describe('Migration Kit State Machine & Transition Guards (KIT-01)', () => {
  // ---------------------------------------------------------------------------
  // 1. Success Path Transitions
  // ---------------------------------------------------------------------------
  describe('Valid Success Path', () => {
    it('traverses the complete 7-step success path in strict order', () => {
      const successSequence: KitBatchStatus[] = [
        'created',
        'extracting',
        'extracted',
        'profiled',
        'cleaned',
        'mapped',
        'dry_run_passed',
        'loading',
        'loaded',
        'validating',
        'validated',
        'reconciled',
      ];

      for (let i = 0; i < successSequence.length - 1; i++) {
        const from = successSequence[i];
        const to = successSequence[i + 1];
        expect(canKitBatchTransition(from, to)).toBe(true);
        expect(() => assertValidKitBatchTransition(from, to, 'test-batch')).not.toThrow();
      }
    });

    it('allows idempotent same-state transitions', () => {
      const states: KitBatchStatus[] = [
        'created',
        'extracting',
        'extracted',
        'profiled',
        'cleaned',
        'mapped',
        'dry_run_passed',
        'loading',
        'loaded',
        'validating',
        'validated',
        'reconciled',
        'failed',
        'load_failed_partial',
        'rollback_pending',
      ];

      for (const s of states) {
        expect(canKitBatchTransition(s, s)).toBe(true);
        expect(() => assertValidKitBatchTransition(s, s, 'test-batch')).not.toThrow();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Forbidden Transitions (State Skipping & Out-of-Order)
  // ---------------------------------------------------------------------------
  describe('Forbidden & Out-of-Order Transitions', () => {
    it('forbids skipping states (e.g., created -> loaded, created -> cleaned)', () => {
      const illegalJumps: [KitBatchStatus, KitBatchStatus][] = [
        ['created', 'extracted'],
        ['created', 'cleaned'],
        ['created', 'mapped'],
        ['created', 'loading'],
        ['created', 'loaded'],
        ['created', 'reconciled'],
        ['extracting', 'loading'],
        ['profiled', 'loaded'],
        ['cleaned', 'validated'],
        ['mapped', 'loading'],
        ['dry_run_passed', 'reconciled'],
      ];

      for (const [from, to] of illegalJumps) {
        expect(canKitBatchTransition(from, to)).toBe(false);
        expect(() => assertValidKitBatchTransition(from, to, 'test-batch')).toThrow(
          IllegalBatchStateTransitionError
        );
      }
    });

    it('forbids resetting to created implicitly', () => {
      const states: KitBatchStatus[] = [
        'extracting',
        'extracted',
        'profiled',
        'cleaned',
        'mapped',
        'loading',
        'load_failed_partial',
        'failed',
      ];

      for (const s of states) {
        expect(() => assertValidKitBatchTransition(s, 'created', 'test-batch')).toThrow(
          IllegalBatchStateTransitionError
        );
      }
    });

    it('forbids transitions out of terminal states (reconciled, rolled_back)', () => {
      const terminalStates: KitBatchStatus[] = ['reconciled', 'rolled_back'];
      const targets: KitBatchStatus[] = ['created', 'extracting', 'loading', 'failed'];

      for (const term of terminalStates) {
        expect(isKitBatchTerminalStatus(term)).toBe(true);
        for (const target of targets) {
          expect(canKitBatchTransition(term, target)).toBe(false);
          expect(() => assertValidKitBatchTransition(term, target, 'test-batch')).toThrow(
            IllegalBatchStateTransitionError
          );
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Failure & Side States
  // ---------------------------------------------------------------------------
  describe('Side States & Failure Handling', () => {
    it('allows in-progress states to transition to failed', () => {
      const failureCapableStates: KitBatchStatus[] = [
        'created',
        'extracting',
        'extracted',
        'profiled',
        'cleaned',
        'mapped',
        'dry_run_passed',
        'loading',
        'loaded',
        'validating',
        'validated',
        'load_failed_partial',
        'rollback_pending',
      ];

      for (const s of failureCapableStates) {
        expect(canKitBatchTransition(s, 'failed')).toBe(true);
        expect(() => assertValidKitBatchTransition(s, 'failed', 'test-batch')).not.toThrow();
      }
    });

    it('allows loading to transition to load_failed_partial', () => {
      expect(canKitBatchTransition('loading', 'load_failed_partial')).toBe(true);
      expect(() =>
        assertValidKitBatchTransition('loading', 'load_failed_partial', 'test-batch')
      ).not.toThrow();
    });

    it('allows load_failed_partial to retry to loading or transition to rollback_pending', () => {
      expect(canKitBatchTransition('load_failed_partial', 'loading')).toBe(true);
      expect(canKitBatchTransition('load_failed_partial', 'rollback_pending')).toBe(true);
      expect(canKitBatchTransition('load_failed_partial', 'failed')).toBe(true);
    });

    it('allows rollback_pending to transition to rolled_back or rollback_blocked', () => {
      expect(canKitBatchTransition('rollback_pending', 'rolled_back')).toBe(true);
      expect(canKitBatchTransition('rollback_pending', 'rollback_blocked')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Checkpoints & Resumption
  // ---------------------------------------------------------------------------
  describe('Checkpoints & Resumption Logic', () => {
    it('computes correct next checkpoint for forward steps', () => {
      expect(computeNextCheckpoint('extracting', 'created')).toBe('extracting');
      expect(computeNextCheckpoint('extracted', 'extracting')).toBe('extracted');
      expect(computeNextCheckpoint('profiled', 'extracted')).toBe('profiled');
      expect(computeNextCheckpoint('cleaned', 'profiled')).toBe('cleaned');
      expect(computeNextCheckpoint('mapped', 'cleaned')).toBe('mapped');
      expect(computeNextCheckpoint('dry_run_passed', 'mapped')).toBe('dry_run_passed');
      expect(computeNextCheckpoint('loading', 'dry_run_passed')).toBe('loading');
      expect(computeNextCheckpoint('loaded', 'loading')).toBe('loaded');
      expect(computeNextCheckpoint('validated', 'loaded')).toBe('validated');
      expect(computeNextCheckpoint('reconciled', 'validated')).toBe('reconciled');
    });

    it('preserves existing checkpoint when transitioning to failed', () => {
      expect(computeNextCheckpoint('failed', 'cleaned')).toBe('cleaned');
      expect(computeNextCheckpoint('failed', 'mapped')).toBe('mapped');
    });

    it('sets checkpoint to load_checkpoint on load_failed_partial', () => {
      expect(computeNextCheckpoint('load_failed_partial', 'loading')).toBe('load_checkpoint');
    });

    it('determines valid resume target from committed checkpoint', () => {
      expect(getValidResumeTarget('created')).toBe('extracting');
      expect(getValidResumeTarget('extracted')).toBe('profiled');
      expect(getValidResumeTarget('profiled')).toBe('cleaned');
      expect(getValidResumeTarget('cleaned')).toBe('mapped');
      expect(getValidResumeTarget('mapped')).toBe('dry_run_passed');
      expect(getValidResumeTarget('dry_run_passed')).toBe('loading');
      expect(getValidResumeTarget('load_checkpoint')).toBe('loading');
      expect(getValidResumeTarget('loaded')).toBe('validating');
      expect(getValidResumeTarget('validated')).toBe('reconciled');
    });

    it('assertValidKitBatchTransition blocks invalid resume destination from failed', () => {
      // If checkpoint was 'cleaned', resuming must go to 'mapped', not 'loading'
      expect(() =>
        assertValidKitBatchTransition('failed', 'loading', 'test-batch', 'cleaned')
      ).toThrow(IllegalBatchStateTransitionError);

      expect(() =>
        assertValidKitBatchTransition('failed', 'mapped', 'test-batch', 'cleaned')
      ).not.toThrow();
    });

    it('correctly identifies resumable states', () => {
      expect(isKitBatchResumableStatus('failed')).toBe(true);
      expect(isKitBatchResumableStatus('load_failed_partial')).toBe(true);
      expect(isKitBatchResumableStatus('reconciled')).toBe(false);
      expect(isKitBatchResumableStatus('loading')).toBe(false);
      expect(isKitBatchResumableStatus('created')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Reconciliation Count Verification
  // ---------------------------------------------------------------------------
  describe('Reconciliation Equation (source = loaded + rejected + merged + skipped)', () => {
    it('passes when equation holds exactly with zero unaccounted rows', () => {
      const res = verifyReconciliationCounts({
        totalRows: 1000,
        loadedRows: 850,
        rejectedRows: 80,
        mergedRows: 50,
        skippedRows: 20,
      });
      expect(res.ok).toBe(true);
      expect(res.unaccounted).toBe(0);
    });

    it('fails when rows are unaccounted (missing or dropped rows)', () => {
      const res = verifyReconciliationCounts({
        totalRows: 1000,
        loadedRows: 800,
        rejectedRows: 80,
        mergedRows: 50,
        skippedRows: 20, // Sum = 950, unaccounted = 50
      });
      expect(res.ok).toBe(false);
      expect(res.unaccounted).toBe(50);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Step Name Resolution
  // ---------------------------------------------------------------------------
  describe('Step Name Resolution', () => {
    it('infers step name from target status', () => {
      expect(resolveStepName('extracting')).toBe('extract');
      expect(resolveStepName('extracted')).toBe('extract');
      expect(resolveStepName('profiled')).toBe('profile');
      expect(resolveStepName('cleaned')).toBe('clean');
      expect(resolveStepName('mapped')).toBe('map');
      expect(resolveStepName('dry_run_passed')).toBe('dry_run');
      expect(resolveStepName('loading')).toBe('load');
      expect(resolveStepName('loaded')).toBe('load');
      expect(resolveStepName('validating')).toBe('validate');
      expect(resolveStepName('validated')).toBe('validate');
      expect(resolveStepName('reconciled')).toBe('reconcile');
    });

    it('honors override step name if provided', () => {
      expect(resolveStepName('failed', 'load')).toBe('load');
    });
  });
});
