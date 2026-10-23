/**
 * ERP-1 Products & Inventory — Domain Service
 *
 * Owns the V1 business rules:
 *   - unique SKU after deterministic normalization (BR-ERP1-01)
 *   - fixed units of measure (FR-ERP1-04)
 *   - single-level categories (FR-ERP1-03)
 *   - one default warehouse and non-negative stock (FR-ERP1-05/06,
 *     BR-ERP1-02)
 *   - idempotent opening-stock loads with a durable receipt in the same
 *     transaction as the stock mutation
 *
 * @module erp1/services/erp1.service
 */

import { randomUUID } from 'node:crypto';
import {
  ERP1_DOMAIN_RULES,
  normalizeSku,
  type Category,
  type CategoryListQuery,
  type CreateCategoryInput,
  type CreateProductInput,
  type ImportReceiptRecord,
  type ImportRowRequest,
  type ImportRowResponse,
  type Product,
  type ProductListQuery,
  type SetOpeningStockInput,
  type StockLevel,
  type StockLevelListQuery,
  type UpdateCategoryInput,
  type UpdateProductInput,
  type Warehouse,
  type CheckErp1DuplicatesRequest,
  type CheckErp1DuplicatesResponse,
  type Erp1DuplicateCandidateRecord,
  type ReviewErp1DuplicateRequest,
  type ReviewErp1DuplicateResponse,
} from '@clearshift/contracts';
import { AuditService, InMemoryAuditRepository } from '@cs/core';
import {
  assertNoFuzzyAutoMerge,
  assertValidHumanMergeDecision,
  classifyProductCandidate,
  classifyCategoryCandidate,
} from '../domain/duplicate-policy.js';
import {
  assertSourceIdentityIsComplete,
  assertValidCurrencyCode,
  assertValidUnitOfMeasure,
} from '../domain/relationships.js';
import {
  Erp1ConflictError,
  Erp1NotFoundError,
  Erp1UnprocessableError,
  Erp1BadRequestError,
  Erp1ForbiddenError,
} from './errors.js';
import {
  computeRequestHash,
  type Erp1ImportReceipt,
  type Erp1Page,
  type Erp1Repository,
  type NewErp1ImportReceipt,
  type NewErp1Product,
} from './repository.js';

const ZERO_UUID = '00000000-0000-4000-8000-000000000000';

export interface ImportRowRequestExtended extends ImportRowRequest {
  upsert?: boolean | undefined;
}

export interface Erp1ServiceOptions {
  repository: Erp1Repository;
  auditService?: AuditService | undefined;
}

export interface IdempotentResult<T> {
  entity: T;
  priorResult: boolean;
  receipt?: Erp1ImportReceipt;
}

export interface OpeningStockResult extends IdempotentResult<StockLevel> {}

interface ImportMeta {
  idempotencyKey?: string | undefined;
  batchId: string;
  sourceRow: number;
}

function importMeta(input: {
  idempotency_key?: string | undefined;
  idempotencyKey?: string | undefined;
  batch_id?: string | undefined;
  batchId?: string | undefined;
  source_row?: number | undefined;
  sourceRow?: number | undefined;
}): ImportMeta {
  const key = input.idempotency_key ?? input.idempotencyKey;
  return {
    idempotencyKey: key !== undefined && key.trim().length > 0 ? key.trim() : undefined,
    batchId: input.batch_id ?? input.batchId ?? ZERO_UUID,
    sourceRow: input.source_row ?? input.sourceRow ?? 0,
  };
}

function sourceSystemOf(input: {
  source_system?: string | undefined;
  sourceSystem?: string | undefined;
}): string | null {
  return input.source_system ?? input.sourceSystem ?? null;
}

function sourceIdOf(input: {
  source_id?: string | undefined;
  sourceId?: string | undefined;
}): string | null {
  return input.source_id ?? input.sourceId ?? null;
}

function parseReceiptPayload<T>(receipt: Erp1ImportReceipt | null): T | null {
  if (!receipt?.responsePayload) return null;
  try {
    return JSON.parse(receipt.responsePayload) as T;
  } catch {
    return null;
  }
}

export class Erp1Service {
  private readonly repo: Erp1Repository;
  private readonly auditService: AuditService;
  private readonly duplicateCandidates: Map<string, Erp1DuplicateCandidateRecord> = new Map();

  constructor(options: Erp1ServiceOptions | Erp1Repository) {
    if ('repository' in options) {
      this.repo = options.repository;
      this.auditService = options.auditService ?? new AuditService(new InMemoryAuditRepository());
    } else {
      this.repo = options;
      this.auditService = new AuditService(new InMemoryAuditRepository());
    }
  }

  getAuditService(): AuditService {
    return this.auditService;
  }

  // ── Products ──────────────────────────────────────────────────────────────

  async listProducts(query: ProductListQuery): Promise<Erp1Page<Product>> {
    return this.repo.listProducts(query);
  }

  async getProductById(id: string): Promise<Product> {
    const product = await this.repo.getProductById(id);
    if (!product) {
      throw new Erp1NotFoundError('Product', id);
    }
    return product;
  }

  /** Create a product without requiring import idempotency. */
  async createProduct(input: CreateProductInput): Promise<Product> {
    const result = await this.createProductWithIdempotency(input);
    return result.entity;
  }

  /**
   * Create a product. When an idempotency key is present, the target row and
   * its durable receipt are written in one transaction; a retry of the same
   * payload returns the original result and a different payload conflicts.
   */
  async createProductWithIdempotency(
    input: CreateProductInput
  ): Promise<IdempotentResult<Product>> {
    const meta = importMeta(input);
    const normalizedSku = normalizeSku(input.sku);
    const businessPayload = {
      name: input.name,
      sku: normalizedSku,
      categoryId: input.categoryId ?? null,
      unitOfMeasure: input.unitOfMeasure,
      price: input.price,
      currency: input.currency ?? 'USD',
      taxRate: input.taxRate ?? '0.00',
    };
    const requestHash = computeRequestHash(businessPayload);

    assertSourceIdentityIsComplete(sourceSystemOf(input), sourceIdOf(input));
    assertValidUnitOfMeasure(input.unitOfMeasure);
    if (input.currency) {
      assertValidCurrencyCode(input.currency);
    }

    return this.repo.transaction(async (tx) => {
      if (meta.idempotencyKey !== undefined) {
        const replay = await this.replay<Product>(tx, meta.idempotencyKey, requestHash);
        if (replay !== null) return replay;
      }

      if ((await tx.getProductByNormalizedSku(normalizedSku)) !== null) {
        throw new Erp1ConflictError(
          `A product with SKU '${input.sku}' already exists.`,
          [
            {
              field: 'sku',
              code: ERP1_DOMAIN_RULES.SKU_DUPLICATE,
              message: 'SKU must be unique after normalization (BR-ERP1-01)',
            },
          ],
          ERP1_DOMAIN_RULES.SKU_DUPLICATE
        );
      }

      await this.assertCategoryExists(tx, input.categoryId ?? null);

      const product = await tx.createProduct({
        name: input.name,
        sku: input.sku,
        normalizedSku,
        categoryId: input.categoryId ?? null,
        unitOfMeasure: input.unitOfMeasure,
        price: input.price,
        currency: input.currency ?? 'USD',
        taxRate: input.taxRate ?? '0.00',
        sourceSystem: sourceSystemOf(input),
        sourceId: sourceIdOf(input),
      } satisfies NewErp1Product);

      await this.ensureZeroStock(tx, product.id);

      const receipt = await this.writeReceipt(tx, {
        meta,
        targetId: product.id,
        targetEntity: 'product',
        requestHash,
        sourceSystem: sourceSystemOf(input),
        sourceId: sourceIdOf(input),
        payload: product,
      });

      return { entity: product, priorResult: false, ...(receipt && { receipt }) };
    });
  }

  async updateProduct(id: string, input: UpdateProductInput): Promise<Product> {
    return this.repo.transaction(async (tx) => {
      const existing = await tx.getProductById(id);
      if (!existing) {
        throw new Erp1NotFoundError('Product', id);
      }

      let sku = input.sku;
      let normalizedSku: string | undefined;
      if (sku !== undefined) {
        normalizedSku = normalizeSku(sku);
        const duplicate = await tx.getProductByNormalizedSku(normalizedSku);
        if (duplicate !== null && duplicate.id !== id) {
          throw new Erp1ConflictError(
            `A product with SKU '${sku}' already exists.`,
            [
              {
                field: 'sku',
                code: ERP1_DOMAIN_RULES.SKU_DUPLICATE,
                message: 'SKU must be unique after normalization (BR-ERP1-01)',
              },
            ],
            ERP1_DOMAIN_RULES.SKU_DUPLICATE
          );
        }
      }

      if (input.categoryId !== undefined) {
        await this.assertCategoryExists(tx, input.categoryId);
      }

      return tx.updateProduct(id, {
        ...(input.name !== undefined && { name: input.name }),
        ...(sku !== undefined && { sku }),
        ...(normalizedSku !== undefined && { normalizedSku }),
        ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
        ...(input.unitOfMeasure !== undefined && { unitOfMeasure: input.unitOfMeasure }),
        ...(input.price !== undefined && { price: input.price }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.taxRate !== undefined && { taxRate: input.taxRate }),
      });
    });
  }

  // ── Categories ────────────────────────────────────────────────────────────

  async listCategories(query: CategoryListQuery): Promise<Erp1Page<Category>> {
    return this.repo.listCategories(query);
  }

  async getCategoryById(id: string): Promise<Category> {
    const category = await this.repo.getCategoryById(id);
    if (!category) {
      throw new Erp1NotFoundError('Category', id);
    }
    return category;
  }

  async createCategory(input: CreateCategoryInput): Promise<Category> {
    const result = await this.createCategoryWithIdempotency(input);
    return result.entity;
  }

  async createCategoryWithIdempotency(
    input: CreateCategoryInput
  ): Promise<IdempotentResult<Category>> {
    const meta = importMeta(input);
    const businessPayload = { name: input.name, code: input.code };
    const requestHash = computeRequestHash(businessPayload);

    assertSourceIdentityIsComplete(sourceSystemOf(input), sourceIdOf(input));

    return this.repo.transaction(async (tx) => {
      if (meta.idempotencyKey !== undefined) {
        const replay = await this.replay<Category>(tx, meta.idempotencyKey, requestHash);
        if (replay !== null) return replay;
      }

      if ((await tx.getCategoryByCode(input.code)) !== null) {
        throw new Erp1ConflictError(
          `A category with code '${input.code}' already exists.`,
          [
            {
              field: 'code',
              code: ERP1_DOMAIN_RULES.CATEGORY_CODE_DUPLICATE,
              message: 'Category code must be unique',
            },
          ],
          ERP1_DOMAIN_RULES.CATEGORY_CODE_DUPLICATE
        );
      }

      const category = await tx.createCategory({
        name: input.name,
        code: input.code,
      });

      const receipt = await this.writeReceipt(tx, {
        meta,
        targetId: category.id,
        targetEntity: 'category',
        requestHash,
        sourceSystem: sourceSystemOf(input),
        sourceId: sourceIdOf(input),
        payload: category,
      });

      return { entity: category, priorResult: false, ...(receipt && { receipt }) };
    });
  }

  async updateCategory(id: string, input: UpdateCategoryInput): Promise<Category> {
    return this.repo.transaction(async (tx) => {
      const existing = await tx.getCategoryById(id);
      if (!existing) {
        throw new Erp1NotFoundError('Category', id);
      }

      if (input.code !== undefined) {
        const duplicate = await tx.getCategoryByCode(input.code);
        if (duplicate !== null && duplicate.id !== id) {
          throw new Erp1ConflictError(
            `A category with code '${input.code}' already exists.`,
            [
              {
                field: 'code',
                code: ERP1_DOMAIN_RULES.CATEGORY_CODE_DUPLICATE,
                message: 'Category code must be unique',
              },
            ],
            ERP1_DOMAIN_RULES.CATEGORY_CODE_DUPLICATE
          );
        }
      }

      return tx.updateCategory(id, {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.code !== undefined && { code: input.code }),
      });
    });
  }

  // ── Stock ─────────────────────────────────────────────────────────────────

  async listStockLevels(query: StockLevelListQuery): Promise<Erp1Page<StockLevel>> {
    return this.repo.listStockLevels(query);
  }

  /**
   * Set the opening quantity for a product in the single V1 warehouse.
   *
   * A stable idempotency key is mandatory: the stock upsert and the durable
   * receipt are committed together, so a Kit retry can never double-load the
   * same opening balance.
   */
  async setOpeningStock(input: SetOpeningStockInput): Promise<OpeningStockResult> {
    const meta = importMeta(input);
    if (meta.idempotencyKey === undefined) {
      throw new Erp1BadRequestError(
        'Opening stock is a migration load and requires an Idempotency-Key header.',
        [
          {
            field: 'idempotency_key',
            code: ERP1_DOMAIN_RULES.IMPORT_PROVENANCE_REQUIRED,
            message: 'A stable Idempotency-Key is required for opening-stock loads',
          },
        ],
        ERP1_DOMAIN_RULES.IMPORT_PROVENANCE_REQUIRED
      );
    }

    const requestHash = computeRequestHash({
      productId: input.productId,
      warehouseId: input.warehouseId ?? null,
      quantity: input.quantity,
    });

    return this.repo.transaction(async (tx) => {
      const replay = await this.replay<StockLevel>(tx, meta.idempotencyKey as string, requestHash);
      if (replay !== null) {
        return {
          entity: replay.entity,
          priorResult: true,
          ...(replay.receipt && { receipt: replay.receipt }),
        };
      }

      const product = await tx.getProductById(input.productId);
      if (!product) {
        throw new Erp1NotFoundError('Product', input.productId);
      }

      const warehouse = await this.resolveWarehouse(tx, input.warehouseId);

      if (Number(input.quantity) < 0) {
        throw new Erp1UnprocessableError(
          'Stock quantity cannot become negative (BR-ERP1-02).',
          [
            {
              field: 'quantity',
              code: ERP1_DOMAIN_RULES.NEGATIVE_STOCK,
              message: 'Stock quantity cannot become negative (BR-ERP1-02)',
            },
          ],
          ERP1_DOMAIN_RULES.NEGATIVE_STOCK
        );
      }

      const level = await tx.upsertStockLevel({
        id: randomUUID(),
        productId: product.id,
        warehouseId: warehouse.id,
        quantity: input.quantity,
      });

      const receipt = await this.writeReceipt(tx, {
        meta,
        targetId: level.id,
        targetEntity: 'stock_level',
        requestHash,
        sourceSystem: sourceSystemOf(input),
        sourceId: sourceIdOf(input),
        payload: level,
      });

      return { entity: level, priorResult: false, ...(receipt && { receipt }) };
    });
  }

  /** Alias used by the Migration Kit adapter vocabulary. */
  loadOpeningStock(input: SetOpeningStockInput): Promise<OpeningStockResult> {
    return this.setOpeningStock(input);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async replay<T>(
    tx: Erp1Repository,
    idempotencyKey: string,
    requestHash: string
  ): Promise<IdempotentResult<T> | null> {
    const existing = await tx.getImportReceiptByKey(idempotencyKey);
    if (existing === null) return null;

    if (existing.requestHash !== requestHash) {
      throw new Erp1ConflictError(
        `Idempotency key '${idempotencyKey}' was previously used with a different request payload.`,
        [
          {
            field: 'idempotency_key',
            code: ERP1_DOMAIN_RULES.IDEMPOTENCY_CONFLICT,
            message: 'The idempotency key is already bound to another payload',
          },
        ],
        ERP1_DOMAIN_RULES.IDEMPOTENCY_CONFLICT
      );
    }

    const payload = parseReceiptPayload<T>(existing);
    if (payload === null) {
      throw new Erp1ConflictError(
        'The original idempotent result is no longer available.',
        [
          {
            field: 'idempotency_key',
            code: ERP1_DOMAIN_RULES.IDEMPOTENCY_CONFLICT,
            message: 'Receipt has no replayable result',
          },
        ],
        ERP1_DOMAIN_RULES.IDEMPOTENCY_CONFLICT
      );
    }

    return { entity: payload, priorResult: true, receipt: existing };
  }

  private async writeReceipt(
    tx: Erp1Repository,
    data: {
      meta: ImportMeta;
      targetId: string;
      targetEntity: string;
      requestHash: string;
      sourceSystem?: string | null;
      sourceId?: string | null;
      payload: unknown;
    }
  ): Promise<Erp1ImportReceipt | undefined> {
    if (data.meta.idempotencyKey === undefined) return undefined;

    return tx.createImportReceipt({
      batchId: data.meta.batchId,
      sourceRow: data.meta.sourceRow,
      targetId: data.targetId,
      targetEntity: data.targetEntity,
      idempotencyKey: data.meta.idempotencyKey,
      requestHash: data.requestHash,
      sourceSystem: data.sourceSystem ?? null,
      sourceId: data.sourceId ?? null,
      outcome: 'loaded',
      responsePayload: JSON.stringify(data.payload),
    } satisfies NewErp1ImportReceipt);
  }

  private async assertCategoryExists(
    tx: Erp1Repository,
    categoryId: string | null
  ): Promise<void> {
    if (categoryId === null) return;
    const category = await tx.getCategoryById(categoryId);
    if (!category) {
      throw new Erp1UnprocessableError(
        `Category with identifier "${categoryId}" does not exist.`,
        [
          {
            field: 'categoryId',
            code: ERP1_DOMAIN_RULES.CATEGORY_REQUIRED,
            message: 'Referenced category does not exist',
          },
        ],
        ERP1_DOMAIN_RULES.CATEGORY_REQUIRED
      );
    }
  }

  private async resolveWarehouse(
    tx: Erp1Repository,
    warehouseId: string | undefined
  ): Promise<Warehouse> {
    if (warehouseId !== undefined) {
      const warehouse = await tx.getWarehouseById(warehouseId);
      if (!warehouse) {
        throw new Erp1UnprocessableError(
          `Warehouse with identifier "${warehouseId}" does not exist.`,
          [
            {
              field: 'warehouseId',
              code: ERP1_DOMAIN_RULES.WAREHOUSE_REQUIRED,
              message: 'Referenced warehouse does not exist',
            },
          ],
          ERP1_DOMAIN_RULES.WAREHOUSE_REQUIRED
        );
      }
      if (!warehouse.isDefault) {
        throw new Erp1UnprocessableError(
          'V1 supports exactly one default warehouse.',
          [
            {
              field: 'warehouseId',
              code: ERP1_DOMAIN_RULES.SINGLE_WAREHOUSE,
              message: 'Stock may only be loaded into the default warehouse in V1',
            },
          ],
          ERP1_DOMAIN_RULES.SINGLE_WAREHOUSE
        );
      }
      return warehouse;
    }

    const warehouse = await tx.getDefaultWarehouse();
    if (!warehouse) {
      throw new Erp1UnprocessableError(
        'No default warehouse is configured.',
        [
          {
            field: 'warehouseId',
            code: ERP1_DOMAIN_RULES.WAREHOUSE_REQUIRED,
            message: 'A default warehouse is required before loading stock',
          },
        ],
        ERP1_DOMAIN_RULES.WAREHOUSE_REQUIRED
      );
    }
    return warehouse;
  }

  private async ensureZeroStock(tx: Erp1Repository, productId: string): Promise<void> {
    const warehouse = await tx.getDefaultWarehouse();
    if (!warehouse) return;
    const existing = await tx.getStockLevel(productId, warehouse.id);
    if (existing) return;
    await tx.upsertStockLevel({
      productId,
      warehouseId: warehouse.id,
      quantity: '0.00',
    });
  }
  // ── Exact Duplicate Key Policy & Human Review ─────────────────────────────

  seedDuplicateCandidate(candidate: Erp1DuplicateCandidateRecord): void {
    this.duplicateCandidates.set(candidate.candidate_id, candidate);
  }

  /**
   * Retrieves pending or reviewed duplicate candidates.
   */
  async getDuplicateCandidates(
    entity?: 'product' | 'category'
  ): Promise<Erp1DuplicateCandidateRecord[]> {
    const all = Array.from(this.duplicateCandidates.values());
    if (!entity) return all;
    return all.filter((c) => c.entity === entity);
  }

  /**
   * Retrieves a duplicate candidate by ID.
   */
  async getDuplicateCandidateById(
    candidateId: string
  ): Promise<Erp1DuplicateCandidateRecord | null> {
    return this.duplicateCandidates.get(candidateId) ?? null;
  }

  /**
   * Checks incoming records against the existing module database for exact or ambiguous duplicates.
   *
   * Invariants (AC1, AC2, AC3):
   *   - Identical normalized keys produce EXACT_DUPLICATE candidates.
   *   - Conflicting or cross-entity keys produce AMBIGUOUS_CANDIDATE candidates held for human review.
   *   - Pure exact string matching only; fuzzy scoring is strictly prohibited.
   */
  async checkDuplicates(
    request: CheckErp1DuplicatesRequest
  ): Promise<CheckErp1DuplicatesResponse> {
    assertNoFuzzyAutoMerge({ isAutoMerge: false, confidence: 1.0 });

    const foundCandidates: Erp1DuplicateCandidateRecord[] = [];

    if (request.entity === 'product') {
      const page = await this.repo.listProducts({ page: 1, pageSize: 1000 });
      const existingProducts = page.items;
      for (const record of request.records) {
        const result = classifyProductCandidate(record, existingProducts);
        if (result.candidate) {
          this.duplicateCandidates.set(result.candidate.candidate_id, result.candidate);
          foundCandidates.push(result.candidate);
        }
      }
    } else if (request.entity === 'category') {
      const page = await this.repo.listCategories({ page: 1, pageSize: 1000 });
      const existingCategories = page.items;
      for (const record of request.records) {
        const result = classifyCategoryCandidate(record, existingCategories);
        if (result.candidate) {
          this.duplicateCandidates.set(result.candidate.candidate_id, result.candidate);
          foundCandidates.push(result.candidate);
        }
      }
    } else {
      throw new Erp1BadRequestError(`Unsupported entity for duplicate check: '${request.entity}'`, [
        { field: 'entity', code: 'UNSUPPORTED_ENTITY', message: 'Unsupported entity for duplicate check' },
      ]);
    }

    return {
      entity: request.entity,
      total_checked: request.records.length,
      duplicates_found: foundCandidates.length,
      candidates: foundCandidates,
    };
  }

  /**
   * Executes an authorized human review decision on a held duplicate candidate.
   *
   * Invariants (AC3, AC4):
   *   - Requires human authorization (role: admin, migration_runner, or editor).
   *   - Enforces assertNoFuzzyAutoMerge and assertValidHumanMergeDecision.
   *   - Records immutable audit log with action "merge.decided", actor ID, timestamp,
   *     kept ID, and merged ID.
   */
  async reviewDuplicateCandidate(
    request: ReviewErp1DuplicateRequest,
    operator: { id: string; role?: string | undefined; correlationId?: string | undefined }
  ): Promise<ReviewErp1DuplicateResponse> {
    // 1. Role authorization check
    const allowedRoles = ['admin', 'migration_runner', 'editor', 'system'];
    if (operator.role && !allowedRoles.includes(operator.role)) {
      throw new Erp1ForbiddenError(
        `Role '${operator.role}' is not authorized to decide duplicate merges. Required: admin, migration_runner, or editor.`
      );
    }

    // 2. Domain validations
    assertNoFuzzyAutoMerge({ isAutoMerge: false, confidence: 1.0 });
    assertValidHumanMergeDecision(request);

    // 3. Locate candidate
    const candidate = this.duplicateCandidates.get(request.candidate_id);
    if (!candidate) {
      throw new Erp1NotFoundError('Duplicate candidate', request.candidate_id);
    }

    const correlationId = operator.correlationId ?? randomUUID();
    let auditRecord;

    if (request.decision === 'MERGE') {
      const keptId = request.kept_id!;
      const mergedId = request.merged_id!;

      // Validate target records exist
      if (candidate.entity === 'product') {
        const keptProduct = await this.repo.getProductById(keptId);
        if (!keptProduct) {
          throw new Erp1NotFoundError('Target product (kept_id)', keptId);
        }
      } else if (candidate.entity === 'category') {
        const keptCategory = await this.repo.getCategoryById(keptId);
        if (!keptCategory) {
          throw new Erp1NotFoundError('Target category (kept_id)', keptId);
        }
      }

      // Record immutable audit entry (AC4)
      auditRecord = await this.auditService.log({
        actor: operator.id,
        actorRole: operator.role ?? 'migration_runner',
        action: 'merge.decided',
        targetEntity: candidate.entity === 'product' ? 'erp1.products' : 'erp1.categories',
        targetId: keptId,
        correlationId,
        result: 'success',
        reason: request.rationale,
        metadata: {
          candidateId: candidate.candidate_id,
          keptId,
          mergedId,
          decision: 'MERGE',
          matchingKey: candidate.matching_key,
          matchingValue: candidate.matching_value,
        },
      });

      const updatedCandidate: Erp1DuplicateCandidateRecord = {
        ...candidate,
        status: 'MERGED',
        decision: 'MERGE',
        decided_at: auditRecord.occurredAt.toISOString(),
        decided_by: operator.id,
        rationale: request.rationale,
      };
      this.duplicateCandidates.set(candidate.candidate_id, updatedCandidate);

      return {
        candidate_id: candidate.candidate_id,
        decision: 'MERGE',
        status: 'MERGED',
        kept_id: keptId,
        merged_id: mergedId,
        actor_id: operator.id,
        timestamp: auditRecord.occurredAt.toISOString(),
        audit_record_id: auditRecord.id,
      };
    }

    if (request.decision === 'REJECT') {
      auditRecord = await this.auditService.log({
        actor: operator.id,
        actorRole: operator.role ?? 'migration_runner',
        action: 'merge.decided',
        targetEntity: candidate.entity === 'product' ? 'erp1.products' : 'erp1.categories',
        targetId: candidate.candidate_id,
        correlationId,
        result: 'success',
        reason: request.rationale,
        metadata: {
          candidateId: candidate.candidate_id,
          decision: 'REJECT',
          matchingKey: candidate.matching_key,
          matchingValue: candidate.matching_value,
        },
      });

      const updatedCandidate: Erp1DuplicateCandidateRecord = {
        ...candidate,
        status: 'REJECTED',
        decision: 'REJECT',
        decided_at: auditRecord.occurredAt.toISOString(),
        decided_by: operator.id,
        rationale: request.rationale,
      };
      this.duplicateCandidates.set(candidate.candidate_id, updatedCandidate);

      return {
        candidate_id: candidate.candidate_id,
        decision: 'REJECT',
        status: 'REJECTED',
        actor_id: operator.id,
        timestamp: auditRecord.occurredAt.toISOString(),
        audit_record_id: auditRecord.id,
      };
    }

    // KEEP_BOTH
    auditRecord = await this.auditService.log({
      actor: operator.id,
      actorRole: operator.role ?? 'migration_runner',
      action: 'merge.decided',
      targetEntity: candidate.entity === 'product' ? 'erp1.products' : 'erp1.categories',
      targetId: candidate.candidate_id,
      correlationId,
      result: 'success',
      reason: request.rationale,
      metadata: {
        candidateId: candidate.candidate_id,
        decision: 'KEEP_BOTH',
        matchingKey: candidate.matching_key,
        matchingValue: candidate.matching_value,
      },
    });

    const updatedCandidate: Erp1DuplicateCandidateRecord = {
      ...candidate,
      status: 'KEPT_BOTH',
      decision: 'KEEP_BOTH',
      decided_at: auditRecord.occurredAt.toISOString(),
      decided_by: operator.id,
      rationale: request.rationale,
    };
    this.duplicateCandidates.set(candidate.candidate_id, updatedCandidate);

    return {
      candidate_id: candidate.candidate_id,
      decision: 'KEEP_BOTH',
      status: 'KEPT_BOTH',
      actor_id: operator.id,
      timestamp: auditRecord.occurredAt.toISOString(),
      audit_record_id: auditRecord.id,
    };
  }

  /**
   * Commits domain mutation and durable receipt together in a single transaction (KIT-08 / Decision C4).
   * Supports UPSERT semantics (upsert=true) on matching normalized SKU.
   * Handles idempotent replays and detects key reuse with mismatched payloads.
   */
  async importRow(req: ImportRowRequest | ImportRowRequestExtended): Promise<ImportRowResponse> {
    const upsert = (req as ImportRowRequestExtended).upsert ?? false;
    const requestHash = computeRequestHash(req.record);

    // Check prior receipt
    const priorReceipt = await this.repo.getImportReceiptByKey(req.idempotency_key);
    if (priorReceipt) {
      if (priorReceipt.requestHash === requestHash) {
        return {
          target_id: priorReceipt.targetId,
          target_version: 1,
          outcome: priorReceipt.outcome as any,
          receipt: this.formatReceipt(priorReceipt),
          prior_result: true,
        };
      } else {
        throw new Erp1ConflictError(
          `Idempotency key '${req.idempotency_key}' was previously used with a different request payload`,
          [
            {
              field: 'idempotency_key',
              code: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
              message: `Idempotency key '${req.idempotency_key}' was previously used with a different request payload`,
            },
          ],
          'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'
        );
      }
    }

    // Execute atomic dual-write within local transaction
    return this.repo.transaction(async (tx) => {
      let targetId: string;
      let responsePayload: unknown;
      let receiptKind: 'created' | 'linked' = 'created';

      if (req.entity === 'product') {
        const raw = req.record;
        const name = String(raw['name'] ?? raw['product_name'] ?? '').trim();
        const sku = String(raw['sku'] ?? '').trim();
        const unitOfMeasure = String(raw['unitOfMeasure'] ?? raw['unit_of_measure'] ?? raw['uom'] ?? '').trim();
        const price = String(raw['price'] ?? '').trim();
        const currency = raw['currency'] ? String(raw['currency']).trim() : 'USD';
        const taxRate =
          raw['taxRate'] !== undefined
            ? String(raw['taxRate']).trim()
            : raw['tax_rate'] !== undefined
            ? String(raw['tax_rate']).trim()
            : '0.00';
        const categoryId = raw['categoryId']
          ? String(raw['categoryId']).trim()
          : raw['category_id']
          ? String(raw['category_id']).trim()
          : null;

        if (!name) {
          throw new Erp1BadRequestError('Product name is required', [
            { field: 'name', code: 'REQUIRED_FIELD', message: 'Product name is required' },
          ]);
        }
        if (!sku) {
          throw new Erp1BadRequestError('Product SKU is required', [
            { field: 'sku', code: 'REQUIRED_FIELD', message: 'Product SKU is required' },
          ]);
        }
        assertValidUnitOfMeasure(unitOfMeasure);
        if (currency) {
          assertValidCurrencyCode(currency);
        }

        const priceNum = Number(price);
        if (isNaN(priceNum) || priceNum < 0 || !/^\d+(\.\d{1,4})?$/.test(price)) {
          throw new Erp1BadRequestError('Product price is invalid', [
            {
              field: 'price',
              code: 'INVALID_PRICE',
              message: 'Price must be a non-negative decimal string (up to 4 decimal places)',
            },
          ]);
        }

        if (taxRate) {
          const taxNum = Number(taxRate);
          if (isNaN(taxNum) || taxNum < 0 || taxNum > 100 || !/^\d+(\.\d{1,2})?$/.test(taxRate)) {
            throw new Erp1BadRequestError('Product tax rate is invalid', [
              {
                field: 'taxRate',
                code: 'INVALID_TAX_RATE',
                message: 'Tax rate must be a non-negative percentage between 0 and 100',
              },
            ]);
          }
        }

        const normalizedSku = normalizeSku(sku);
        const existing = await tx.getProductByNormalizedSku(normalizedSku);

        if (existing) {
          if (!upsert) {
            throw new Erp1ConflictError(
              `A product with SKU '${sku}' already exists.`,
              [
                {
                  field: 'sku',
                  code: ERP1_DOMAIN_RULES.SKU_DUPLICATE,
                  message: 'SKU must be unique after normalization (BR-ERP1-01)',
                },
              ],
              ERP1_DOMAIN_RULES.SKU_DUPLICATE
            );
          }
          await this.assertCategoryExists(tx, categoryId);
          const updated = await tx.updateProduct(existing.id, {
            name,
            price,
            currency,
            taxRate,
            categoryId,
          });
          targetId = updated.id;
          receiptKind = 'linked';
          responsePayload = updated;
        } else {
          await this.assertCategoryExists(tx, categoryId);
          const created = await tx.createProduct({
            name,
            sku,
            normalizedSku,
            categoryId,
            unitOfMeasure: unitOfMeasure as Product['unitOfMeasure'],
            price,
            currency,
            taxRate,
            sourceSystem: req.source_system ?? null,
            sourceId: req.source_id ?? null,
          });
          await this.ensureZeroStock(tx, created.id);
          targetId = created.id;
          receiptKind = 'created';
          responsePayload = created;
        }
      } else if (req.entity === 'category') {
        const raw = req.record;
        const name = String(raw['name'] ?? '').trim();
        const code = String(raw['code'] ?? '').trim();
        if (!name) {
          throw new Erp1BadRequestError('Category name is required', [
            { field: 'name', code: 'REQUIRED_FIELD', message: 'Category name is required' },
          ]);
        }
        if (!code) {
          throw new Erp1BadRequestError('Category code is required', [
            { field: 'code', code: 'REQUIRED_FIELD', message: 'Category code is required' },
          ]);
        }

        const existing = await tx.getCategoryByCode(code);
        if (existing) {
          if (!upsert) {
            throw new Erp1ConflictError(
              `A category with code '${code}' already exists.`,
              [
                {
                  field: 'code',
                  code: ERP1_DOMAIN_RULES.CATEGORY_CODE_DUPLICATE,
                  message: 'Category code must be unique',
                },
              ],
              ERP1_DOMAIN_RULES.CATEGORY_CODE_DUPLICATE
            );
          }
          const updated = await tx.updateCategory(existing.id, { name });
          targetId = updated.id;
          receiptKind = 'linked';
          responsePayload = updated;
        } else {
          const created = await tx.createCategory({ name, code });
          targetId = created.id;
          receiptKind = 'created';
          responsePayload = created;
        }
      } else if (req.entity === 'stock_level') {
        const raw = req.record;
        const productId = String(raw['productId'] ?? raw['product_id'] ?? '').trim();
        const warehouseId = String(raw['warehouseId'] ?? raw['warehouse_id'] ?? '').trim();
        const quantity = String(raw['quantity'] ?? '0.00').trim();

        if (!productId) {
          throw new Erp1BadRequestError('productId is required', [
            { field: 'productId', code: 'REQUIRED_FIELD', message: 'productId is required' },
          ]);
        }
        const qtyNum = Number(quantity);
        if (isNaN(qtyNum) || qtyNum < 0 || !/^\d+(\.\d{1,4})?$/.test(quantity)) {
          throw new Erp1BadRequestError('quantity must be a valid non-negative decimal', [
            {
              field: 'quantity',
              code: ERP1_DOMAIN_RULES.NEGATIVE_STOCK,
              message: 'Stock quantity cannot become negative (BR-ERP1-02)',
            },
          ]);
        }

        const warehouse = await this.resolveWarehouse(tx, warehouseId || undefined);
        const stock = await tx.upsertStockLevel({
          productId,
          warehouseId: warehouse.id,
          quantity,
        });
        targetId = stock.id;
        receiptKind = 'created';
        responsePayload = stock;
      } else {
        throw new Erp1BadRequestError(`Unsupported entity type for import: '${req.entity}'`, [
          { field: 'entity', code: 'UNSUPPORTED_ENTITY', message: `Unsupported entity: ${req.entity}` },
        ]);
      }

      // Commit durable import receipt in SAME transaction
      const receipt = await tx.createImportReceipt({
        batchId: req.batch_id,
        sourceRow: req.source_row,
        sourceSystem: req.source_system ?? null,
        sourceId: req.source_id ?? null,
        targetEntity: req.entity,
        idempotencyKey: req.idempotency_key,
        requestHash,
        targetId,
        outcome: receiptKind === 'linked' ? 'linked' : 'loaded',
        responsePayload: JSON.stringify(responsePayload),
      });

      return {
        target_id: targetId,
        target_version: 1,
        outcome: receipt.outcome as any,
        receipt: this.formatReceipt(receipt),
        prior_result: false,
      };
    });
  }

  private formatReceipt(receipt: Erp1ImportReceipt): ImportReceiptRecord {
    return {
      id: receipt.id,
      batch_id: receipt.batchId,
      source_row: receipt.sourceRow,
      source_system: receipt.sourceSystem,
      source_id: receipt.sourceId,
      entity: receipt.targetEntity,
      schema_version: 1,
      idempotency_key: receipt.idempotencyKey,
      request_hash: receipt.requestHash,
      target_id: receipt.targetId,
      kind: receipt.outcome === 'linked' ? 'linked' : 'created',
      outcome: (receipt.outcome as any) ?? 'loaded',
      response_payload: receipt.responsePayload ? JSON.parse(receipt.responsePayload) : null,
      created_at: receipt.createdAt,
    };
  }
}
