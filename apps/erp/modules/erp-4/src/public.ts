import { ReferenceResolver } from "@cs/kernel";

export interface AccountPublicSummary {
  id: string;
  code: string;
  type: string;
}

export class Erp4ReferenceResolver implements ReferenceResolver {
  async exists(entityType: string, _id: string): Promise<boolean> {
    return entityType === "account" || entityType === "period" || entityType === "journal_entry";
  }

  async get<T = AccountPublicSummary>(entityType: string, id: string): Promise<T | null> {
    if (entityType === "account") {
      return {
        id,
        code: "1010",
        type: "asset"
      } as unknown as T;
    }
    return null;
  }
}

export const erp4Resolver = new Erp4ReferenceResolver();
