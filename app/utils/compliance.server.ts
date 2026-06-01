import prisma from "../db.server";

/**
 * Delete all data SKUward stores for a shop, in response to the shop/redact
 * GDPR webhook (fired ~48h after uninstall). SKUward stores no customer PII —
 * only merchant-scoped operational data — so this removes everything keyed to
 * the shop. POLineItems cascade from PurchaseOrder (onDelete: Cascade).
 *
 * Order matters: PurchaseOrder has a FK to Supplier, so POs are deleted before
 * suppliers. Wrapped in a transaction so a partial failure rolls back.
 */
export async function redactShopData(shop: string): Promise<void> {
  await prisma.$transaction([
    prisma.costRecord.deleteMany({ where: { shop } }),
    prisma.reorderRule.deleteMany({ where: { shop } }),
    prisma.purchaseOrder.deleteMany({ where: { shop } }), // cascades POLineItem
    prisma.supplier.deleteMany({ where: { shop } }),
    prisma.shopPlan.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);
}
