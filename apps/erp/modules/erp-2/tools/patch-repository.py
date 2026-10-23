#!/usr/bin/env python3
"""Fixes 3 real defects in DrizzleErp2Repository (apps/erp/modules/erp-2/src/services/repository.ts).
Idempotent: exits cleanly if already patched. Fails loudly if the code does not look as expected."""
import sys, re, pathlib

path = pathlib.Path(sys.argv[1])
src = path.read_text()

if "escapeLike(" in src:
    print("repository.ts already patched - skipping")
    sys.exit(0)

def must_replace(text, old, new, label):
    if text.count(old) != 1:
        sys.exit(f"PATCH FAILED ({label}): expected exactly 1 match, found {text.count(old)}. Edit by hand, see docs.")
    return text.replace(old, new)

# 1. imports
src = must_replace(
    src,
    "import { eq, like, desc, sql, count } from 'drizzle-orm';",
    "import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';",
    "imports",
)

# 2. helper before the Drizzle class
marker = "export class DrizzleErp2Repository implements Erp2Repository {"
helper = '''/** Escapes LIKE/ILIKE wildcards so user search text is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\\\%_]/g, (ch) => `\\\\${ch}`);
}

'''
src = must_replace(src, marker, helper + marker, "helper")

head, cls = src.split(marker, 1)
cls = marker + cls

# 3. listVendors: filter + count must share the same WHERE, search is case-insensitive on name and tax number
cls = must_replace(
    cls,
    """    let baseQuery = this.db.select().from(erp2Vendors);
    if (query.search) {
      baseQuery = baseQuery.where(like(erp2Vendors.name, `%${query.search}%`)) as any;
    }

    const rows = await (baseQuery as any).limit(pageSize).offset(offset).orderBy(erp2Vendors.name);
    const countRes = await this.db.select({ value: count() }).from(erp2Vendors);""",
    """    const pattern = query.search ? `%${escapeLike(query.search)}%` : null;
    const where = pattern
      ? or(ilike(erp2Vendors.name, pattern), ilike(erp2Vendors.tax_number, pattern))
      : undefined;

    const rows = await this.db
      .select()
      .from(erp2Vendors)
      .where(where)
      .orderBy(erp2Vendors.name, erp2Vendors.id)
      .limit(pageSize)
      .offset(offset);
    const countRes = await this.db.select({ value: count() }).from(erp2Vendors).where(where);""",
    "listVendors",
)

# 4. listPurchaseOrders: combine filters with AND (second .where() used to overwrite the first) and count with the same filter
cls = must_replace(
    cls,
    """    let baseQuery = this.db.select().from(erp2PurchaseOrders);
    if (query.vendor_id) {
      baseQuery = baseQuery.where(eq(erp2PurchaseOrders.vendor_id, query.vendor_id)) as any;
    }
    if (query.status) {
      baseQuery = baseQuery.where(eq(erp2PurchaseOrders.status, query.status)) as any;
    }

    const rows = await (baseQuery as any).limit(pageSize).offset(offset).orderBy(desc(erp2PurchaseOrders.order_date));
    const countRes = await this.db.select({ value: count() }).from(erp2PurchaseOrders);""",
    """    const conditions: SQL[] = [];
    if (query.vendor_id) conditions.push(eq(erp2PurchaseOrders.vendor_id, query.vendor_id));
    if (query.status) conditions.push(eq(erp2PurchaseOrders.status, query.status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(erp2PurchaseOrders)
      .where(where)
      .orderBy(desc(erp2PurchaseOrders.order_date), erp2PurchaseOrders.id)
      .limit(pageSize)
      .offset(offset);
    const countRes = await this.db.select({ value: count() }).from(erp2PurchaseOrders).where(where);""",
    "listPurchaseOrders",
)

# 5. createPurchaseOrder: header + lines in ONE transaction (was two un-wrapped statements -> orphan header on line failure)
start_sig = "  async createPurchaseOrder(po: Omit<PurchaseOrder, 'created_at' | 'updated_at'>): Promise<PurchaseOrder> {\n    const [createdPo]"
s = cls.find(start_sig)
e = cls.find("  async updatePurchaseOrderStatus", s)
if s < 0 or e < 0:
    sys.exit("PATCH FAILED (createPurchaseOrder): method not found")
new_method = """  async createPurchaseOrder(po: Omit<PurchaseOrder, 'created_at' | 'updated_at'>): Promise<PurchaseOrder> {
    // Header and lines commit together or not at all (nested call inside executeTransactional becomes a savepoint).
    return this.db.transaction(async (tx) => {
      const [createdPo] = await tx
        .insert(erp2PurchaseOrders)
        .values({
          id: po.id,
          po_number: po.po_number,
          vendor_id: po.vendor_id,
          order_date: po.order_date,
          status: po.status,
          currency: po.currency,
          total: po.total,
        })
        .returning();

      if (!createdPo) throw new Error('Failed to create purchase order');

      if (po.lines.length > 0) {
        await tx.insert(erp2PoLines).values(
          po.lines.map((line) => ({
            id: line.id,
            po_id: po.id,
            product_id: line.product_id,
            quantity: line.quantity,
            price: line.price,
            line_total: line.line_total,
          }))
        );
      }

      return {
        ...po,
        created_at: createdPo.created_at.toISOString(),
        updated_at: createdPo.updated_at.toISOString(),
      };
    });
  }

"""
cls = cls[:s] + new_method + cls[e:]

path.write_text(head + cls)
print("repository.ts patched: listVendors, listPurchaseOrders, createPurchaseOrder")
