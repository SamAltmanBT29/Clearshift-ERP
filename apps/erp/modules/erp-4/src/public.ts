import { ReferenceResolver } from "@cs/kernel";
import type { FinanceRepository } from "./services/repository.js";

export interface AccountPublicSummary {
  id: string;
  code: string;
  name: string;
  type: string;
  currency_code: string;
  is_active: boolean;
  is_posting_account: boolean;
}

export interface PeriodPublicSummary {
  id: string;
  period_label: string;
  status: string;
  fiscal_year: string;
}

export interface JournalEntryPublicSummary {
  id: string;
  entry_number: string;
  status: string;
  posting_date: string;
  currency_code: string;
}

export class Erp4ReferenceResolver implements ReferenceResolver {
  constructor(private readonly repository?: FinanceRepository) {}

  async exists(entityType: string, id: string): Promise<boolean> {
    if (this.repository) {
      if (entityType === "account") {
        const acct = await this.repository.getAccountById(id);
        return Boolean(acct);
      }
      if (entityType === "period") {
        const p = (await this.repository.getPeriodById(id)) ?? (await this.repository.getPeriodByLabel(id));
        return Boolean(p);
      }
      if (entityType === "journal_entry") {
        const je = await this.repository.getJournalEntryById(id);
        return Boolean(je);
      }
      return false;
    }
    return entityType === "account" || entityType === "period" || entityType === "journal_entry";
  }

  async get<T = unknown>(entityType: string, id: string): Promise<T | null> {
    if (this.repository) {
      if (entityType === "account") {
        const acct = await this.repository.getAccountById(id);
        if (!acct) return null;
        return {
          id: acct.id,
          code: acct.code,
          name: acct.name,
          type: acct.type,
          currency_code: acct.currency_code,
          is_active: acct.is_active,
          is_posting_account: acct.is_posting_account,
        } as unknown as T;
      }
      if (entityType === "period") {
        const p = (await this.repository.getPeriodById(id)) ?? (await this.repository.getPeriodByLabel(id));
        if (!p) return null;
        return {
          id: p.id,
          period_label: p.period_label,
          status: p.status,
          fiscal_year: p.fiscal_year,
        } as unknown as T;
      }
      if (entityType === "journal_entry") {
        const je = await this.repository.getJournalEntryById(id);
        if (!je) return null;
        return {
          id: je.id,
          entry_number: je.entry_number,
          status: je.status,
          posting_date: je.posting_date,
          currency_code: je.currency_code,
        } as unknown as T;
      }
      return null;
    }
    if (entityType === "account") {
      return {
        id,
        code: "1010",
        type: "asset",
      } as unknown as T;
    }
    return null;
  }
}

export const erp4Resolver = new Erp4ReferenceResolver();
