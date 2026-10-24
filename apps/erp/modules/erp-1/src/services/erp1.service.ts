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
  CreateCategoryInputSchema,
  CreateProductInputSchema,
  SetOpeningStockInputSchema,
  type Category,
  type CategoryListQuery,
  type CreateCategoryInput,
  type CreateProductInput,
  type Product,
  type ProductListQuery,
  type SetOpeningStockInput,
  type StockLevel,
  type StockLevelListQuery,
  type UpdateCategoryInput,
  type UpdateProductInput,
  type Warehouse,
  type ImportOutcome,
  type ImportReceiptRecord,
  type ImportRowRequest,
  type ImportRowResponse,
} from '@clearshift/contracts';
import {
  Erp1ConflictError,
  Erp1NotFoundError,
  Erp1UnprocessableError,
  Erp1BadRequestError,
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

export interface Erp1ServiceOptions {
  repository: Erp1Repository;
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

export interface ImportRowRequestExtended extends ImportRowRequest {
  upsert?: boolean;
}

function toReceiptRecord(
  receipt: Erp1ImportReceipt,
  kind: 'created' | 'linked' = (receipt.kind as 'created' | 'linked') ?? 'created'
): ImportReceiptRecord {
  return {
    id: receipt.id,
    batch_id: receipt.batchId,
    source_row: receipt.sourceRow,
    source_system: receipt.sourceSystem ?? null,
    source_id: receipt.sourceId ?? null,
    entity: receipt.targetEntity,
    schema_version: 1,
    idempotency_key: receipt.idempotencyKey,
    request_hash: receipt.requestHash,
    target_id: receipt.targetId,
    kind,
    outcome: (receipt.outcome as ImportOutcome) || 'loaded',
    response_payload: receipt.responsePayload ? JSON.parse(receipt.responsePayload) : null,
    created_at:
      typeof receipt.createdAt === 'string'
        ? new Date(receipt.createdAt).toISOString()
        : new Date().toISOString(),
  };
}

function normalizeProductRecord(record: Record<string, unknown>): Record<string, unknown> {
  const result = { ...record };
  if (result['unit_of_measure'] !== undefined && result['unitOfMeasure'] === undefined) {
    result['unitOfMeasure'] = result['unit_of_measure'];
    delete result['unit_of_measure'];
  }
  if (result['category_id'] !== undefined && result['categoryId'] === undefined) {
    result['categoryId'] = result['category_id'];
    delete result['category_id'];
  }
  if (result['tax_rate'] !== undefined && result['taxRate'] === undefined) {
    result['taxRate'] = result['tax_rate'];
    delete result['tax_rate'];
  }
  if (result['notification_email'] !== undefined && result['notificationEmail'] === undefined) {
    result['notificationEmail'] = result['notification_email'];
    delete result['notification_email'];
  }
  if (result['contact_phone'] !== undefined && result['contactPhone'] === undefined) {
    result['contactPhone'] = result['contact_phone'];
    delete result['contact_phone'];
  }
  return result;
}

function normalizeStockRecord(record: Record<string, unknown>): Record<string, unknown> {
  const result = { ...record };
  if (result['product_id'] !== undefined && result['productId'] === undefined) {
    result['productId'] = result['product_id'];
    delete result['product_id'];
  }
  if (result['warehouse_id'] !== undefined && result['warehouseId'] === undefined) {
    result['warehouseId'] = result['warehouse_id'];
    delete result['warehouse_id'];
  }
  return result;
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

  constructor(options: Erp1ServiceOptions | Erp1Repository) {
    this.repo = 'repository' in options ? options.repository : options;
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

  /**
   * Loads a single row as part of Migration Kit integration (KIT-08 / Decision C4).
   *
   * Commits domain mutation and durable receipt together in a single local transaction.
   * Handles idempotent replays (200 OK with prior_result: true) and detects key reuse with
   * mismatched payloads (409 Conflict).
   */
  async importRow(req: ImportRowRequest | ImportRowRequestExtended): Promise<ImportRowResponse> {
    const upsert = (req as ImportRowRequestExtended).upsert ?? false;
    const requestHash = computeRequestHash(req.record);

    // 1. Check prior receipt
    const priorReceipt = await this.repo.getImportReceiptByKey(req.idempotency_key);
    if (priorReceipt) {
      if (priorReceipt.requestHash === requestHash) {
        return {
          target_id: priorReceipt.targetId,
          target_version: 1,
          outcome: (priorReceipt.outcome as ImportOutcome) || 'loaded',
          receipt: toReceiptRecord(priorReceipt),
          prior_result: true,
        };
      } else {
        throw new Erp1ConflictError(
          `Idempotency key '${req.idempotency_key}' was previously used with a different request payload.`,
          [
            {
              field: 'idempotency_key',
              code: ERP1_DOMAIN_RULES.IDEMPOTENCY_CONFLICT,
              message: `Idempotency key '${req.idempotency_key}' was previously used with a different request payload`,
            },
          ],
          ERP1_DOMAIN_RULES.IDEMPOTENCY_CONFLICT
        );
      }
    }

    // 2. Execute transactional dual-write
    return this.repo.transaction(async (tx) => {
      let targetId: string;
      let responsePayload: unknown;
      let receiptKind: 'created' | 'linked' = 'created';

      const entity = req.entity.toLowerCase();

      if (entity === 'product' || entity === 'products') {
        const normalizedInput = normalizeProductRecord(req.record);
        const parsed = CreateProductInputSchema.safeParse(normalizedInput);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          throw new Erp1BadRequestError(
            first?.message ?? 'Invalid product data',
            parsed.error.issues.map((i) => ({
              field: i.path.join('.'),
              code: i.code,
              message: i.message,
            }))
          );
        }
        const data = parsed.data;
        const normalizedSku = normalizeSku(data.sku);
        const existing = await tx.getProductByNormalizedSku(normalizedSku);

        if (existing) {
          if (!upsert) {
            throw new Erp1ConflictError(
              `A product with SKU '${data.sku}' already exists.`,
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
          if (data.categoryId) {
            await this.assertCategoryExists(tx, data.categoryId);
          }
          const updated = await tx.updateProduct(existing.id, {
            name: data.name,
            categoryId: data.categoryId ?? null,
            unitOfMeasure: data.unitOfMeasure,
            price: data.price,
            currency: data.currency ?? 'USD',
            taxRate: data.taxRate ?? '0.00',
          });
          targetId = updated.id;
          receiptKind = 'linked';
          responsePayload = updated;
        } else {
          if (data.categoryId) {
            await this.assertCategoryExists(tx, data.categoryId);
          }
          const created = await tx.createProduct({
            name: data.name,
            sku: data.sku,
            normalizedSku,
            categoryId: data.categoryId ?? null,
            unitOfMeasure: data.unitOfMeasure,
            price: data.price,
            currency: data.currency ?? 'USD',
            taxRate: data.taxRate ?? '0.00',
            sourceSystem: sourceSystemOf(data) ?? req.source_system ?? null,
            sourceId: sourceIdOf(data) ?? req.source_id ?? null,
          });
          await this.ensureZeroStock(tx, created.id);
          targetId = created.id;
          receiptKind = 'created';
          responsePayload = created;
        }
      } else if (entity === 'category' || entity === 'categories') {
        const parsed = CreateCategoryInputSchema.safeParse(req.record);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          throw new Erp1BadRequestError(
            first?.message ?? 'Invalid category data',
            parsed.error.issues.map((i) => ({
              field: i.path.join('.'),
              code: i.code,
              message: i.message,
            }))
          );
        }
        const data = parsed.data;
        const existing = await tx.getCategoryByCode(data.code);

        if (existing) {
          if (!upsert) {
            throw new Erp1ConflictError(
              `A category with code '${data.code}' already exists.`,
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
          const updated = await tx.updateCategory(existing.id, {
            name: data.name,
          });
          targetId = updated.id;
          receiptKind = 'linked';
          responsePayload = updated;
        } else {
          const created = await tx.createCategory({
            name: data.name,
            code: data.code,
          });
          targetId = created.id;
          receiptKind = 'created';
          responsePayload = created;
        }
      } else if (
        entity === 'stock_level' ||
        entity === 'stock' ||
        entity === 'opening_stock'
      ) {
        const normalizedInput = normalizeStockRecord(req.record);
        const parsed = SetOpeningStockInputSchema.safeParse(normalizedInput);
        if (!parsed.success) {
          const negativeStock = parsed.error.issues.find((issue) =>
            issue.message.includes('Stock quantity cannot become negative')
          );
          if (negativeStock) {
            throw new Erp1UnprocessableError(
              negativeStock.message,
              [
                {
                  field: negativeStock.path.join('.'),
                  code: ERP1_DOMAIN_RULES.NEGATIVE_STOCK,
                  message: negativeStock.message,
                },
              ],
              ERP1_DOMAIN_RULES.NEGATIVE_STOCK
            );
          }
          const first = parsed.error.issues[0];
          throw new Erp1BadRequestError(
            first?.message ?? 'Invalid opening stock data',
            parsed.error.issues.map((i) => ({
              field: i.path.join('.'),
              code: i.code,
              message: i.message,
            }))
          );
        }
        const data = parsed.data;
        const product = await tx.getProductById(data.productId);
        if (!product) {
          throw new Erp1NotFoundError('Product', data.productId);
        }
        const warehouse = await this.resolveWarehouse(tx, data.warehouseId);
        if (Number(data.quantity) < 0) {
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
          quantity: data.quantity,
        });
        targetId = level.id;
        receiptKind = 'linked';
        responsePayload = level;
      } else if (entity === 'warehouse' || entity === 'warehouses') {
        const defaultWh = await tx.getDefaultWarehouse();
        if (!defaultWh) {
          throw new Erp1UnprocessableError(
            'No default warehouse is configured.',
            [
              {
                field: 'warehouseId',
                code: ERP1_DOMAIN_RULES.WAREHOUSE_REQUIRED,
                message: 'A default warehouse is required',
              },
            ],
            ERP1_DOMAIN_RULES.WAREHOUSE_REQUIRED
          );
        }
        targetId = defaultWh.id;
        receiptKind = 'linked';
        responsePayload = defaultWh;
      } else {
        throw new Erp1BadRequestError(
          `Unsupported entity type for import: '${req.entity}'`,
          [
            {
              field: 'entity',
              code: 'UNSUPPORTED_ENTITY',
              message: `Unsupported entity type '${req.entity}'`,
            },
          ]
        );
      }

      // 3. Dual-write durable import receipt in SAME transaction
      const receipt = await tx.createImportReceipt({
        batchId: req.batch_id,
        sourceRow: req.source_row,
        sourceSystem: req.source_system ?? null,
        sourceId: req.source_id ?? null,
        targetId,
        targetEntity: req.entity,
        idempotencyKey: req.idempotency_key,
        requestHash,
        kind: receiptKind,
        outcome: 'loaded',
        responsePayload: JSON.stringify(responsePayload),
      });

      return {
        target_id: targetId,
        target_version: 1,
        outcome: 'loaded',
        receipt: toReceiptRecord(receipt, receiptKind),
        prior_result: false,
      };
    });
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
}
