/**
 * ReferenceResolver Port (Decision C7 & Section 4.1)
 * Enforces cross-module referential integrity without direct cross-schema database FKs.
 */
export interface ReferenceResolver {
  /**
   * Asserts whether an entity of a specific type and ID exists in the owning module.
   */
  exists(entityType: string, id: string): Promise<boolean>;

  /**
   * Retrieves public summary projection of an entity from the owning module.
   */
  get<T = unknown>(entityType: string, id: string): Promise<T | null>;
}
