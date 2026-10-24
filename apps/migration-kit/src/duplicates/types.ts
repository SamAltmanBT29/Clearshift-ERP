/**
 * ClearShift Migration Kit — Duplicate Review Types & Storage Contract (KIT-10)
 *
 * @module migration-kit/duplicates/types
 */

import {
  type DuplicateCandidateItem,
  type SubmitDuplicateReviewInput,
  type ExactDuplicateRuleIdType,
  type DuplicateCandidateScope,
  type DuplicateReviewDecision,
  type KitDuplicateCandidateStatus,
} from '@clearshift/contracts';

export interface DuplicateDetectionOptions {
  rules?: ExactDuplicateRuleIdType[];
  entityScope?: string;
  jurisdiction?: string;
  ruleVersion?: string;
}

export interface DuplicateDetectionResult {
  inFileDuplicates: DuplicateCandidateItem[];
  targetExistingCandidates: DuplicateCandidateItem[];
  totalCandidates: number;
}

export interface IDuplicateCandidateStore {
  saveCandidate(candidate: DuplicateCandidateItem): Promise<void>;
  saveCandidates(candidates: DuplicateCandidateItem[]): Promise<void>;
  getCandidate(id: string): Promise<DuplicateCandidateItem | null>;
  listCandidatesByBatch(
    batchId: string,
    filter?: {
      status?: KitDuplicateCandidateStatus;
      scope?: DuplicateCandidateScope;
    }
  ): Promise<DuplicateCandidateItem[]>;
  updateCandidate(
    id: string,
    updates: Partial<DuplicateCandidateItem>
  ): Promise<DuplicateCandidateItem>;
  clear(): void;
}

export class InMemoryDuplicateCandidateStore implements IDuplicateCandidateStore {
  private candidates: Map<string, DuplicateCandidateItem> = new Map();

  public async saveCandidate(candidate: DuplicateCandidateItem): Promise<void> {
    this.candidates.set(candidate.id, { ...candidate });
  }

  public async saveCandidates(candidates: DuplicateCandidateItem[]): Promise<void> {
    for (const c of candidates) {
      await this.saveCandidate(c);
    }
  }

  public async getCandidate(id: string): Promise<DuplicateCandidateItem | null> {
    const found = this.candidates.get(id);
    return found ? { ...found } : null;
  }

  public async listCandidatesByBatch(
    batchId: string,
    filter?: {
      status?: KitDuplicateCandidateStatus;
      scope?: DuplicateCandidateScope;
    }
  ): Promise<DuplicateCandidateItem[]> {
    let result = Array.from(this.candidates.values()).filter((c) => c.batchId === batchId);
    if (filter?.status) {
      result = result.filter((c) => c.status === filter.status);
    }
    if (filter?.scope) {
      result = result.filter((c) => c.scope === filter.scope);
    }
    return result.map((c) => ({ ...c }));
  }

  public async updateCandidate(
    id: string,
    updates: Partial<DuplicateCandidateItem>
  ): Promise<DuplicateCandidateItem> {
    const existing = this.candidates.get(id);
    if (!existing) {
      throw new Error(`Duplicate candidate '${id}' not found`);
    }
    const updated: DuplicateCandidateItem = {
      ...existing,
      ...updates,
    };
    this.candidates.set(id, updated);
    return { ...updated };
  }

  public clear(): void {
    this.candidates.clear();
  }
}
