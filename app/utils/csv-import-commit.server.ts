/**
 * CSV import — execution layer (DB writes).
 *
 * Takes a resolved preview summary and commits creatable POs in a single
 * transaction (all-or-nothing). Suppliers are matched by (shop, name) or
 * created. POs whose poNumber already exists for the shop are skipped
 * (reported), so re-running an import is safe.
 *
 * Gating: CSV import is a paid feature (STARTER+). FREE plans can preview
 * but not commit.
 */

import prisma from "../db.server";
import { getShopPlan } from "./billing.server";
import type { PreviewSummary, ResolvedPO } from "./csv-import-preview";

export interface ImportCommitResult {
  createdPOCount: number;
  createdLineItemCount: number;
  createdSupplierCount: number;
  reusedSupplierCount: number;
  skippedExistingPONumbers: string[];
  includedAmountTotal: number;
  excludedAmountTotal: number;
  excludedLineCount: number;
}

export class ImportGatingError extends Error {
  constructor(public plan: string) {
    super("CSV import requires a paid plan");
    this.name = "ImportGatingError";
  }
}

/** True if the plan may commit (not just preview) a CSV import. */
export function canCommitImport(plan: string): boolean {
  return plan === "STARTER" || plan === "PRO";
}

/**
 * Commit a resolved preview to the database.
 * Only POs with >=1 matched line are created. Matched line items only.
 *
 * @throws ImportGatingError if the shop's plan is not allowed to import.
 */
export async function commitImport(
  shop: string,
  summary: PreviewSummary,
): Promise<ImportCommitResult> {
  const plan = await getShopPlan(shop);
  if (!canCommitImport(plan)) {
    throw new ImportGatingError(plan);
  }

  const creatablePOs = summary.pos.filter((p) => p.includedCount > 0);

  // Pre-compute distinct vendor names needed.
  const vendorNames = Array.from(new Set(creatablePOs.map((p) => p.vendor)));

  // Existing PO numbers for this shop (to skip duplicates).
  const existingPOs = await prisma.purchaseOrder.findMany({
    where: { shop, poNumber: { in: creatablePOs.map((p) => p.poNumber) } },
    select: { poNumber: true },
  });
  const existingSet = new Set(existingPOs.map((p) => p.poNumber));

  // Existing suppliers for this shop by name.
  const existingSuppliers = await prisma.supplier.findMany({
    where: { shop, name: { in: vendorNames } },
    select: { id: true, name: true },
  });
  const supplierByName = new Map(existingSuppliers.map((s) => [s.name, s.id]));

  let createdSupplierCount = 0;
  const reusedSupplierCount = supplierByName.size;

  const result = await prisma.$transaction(async (tx) => {
    // 1) ensure suppliers
    for (const name of vendorNames) {
      if (supplierByName.has(name)) continue;
      const created = await tx.supplier.create({
        data: { shop, name },
        select: { id: true, name: true },
      });
      supplierByName.set(name, created.id);
      createdSupplierCount++;
    }

    // 2) create POs + matched line items
    let createdPOCount = 0;
    let createdLineItemCount = 0;
    const skipped: string[] = [];

    for (const po of creatablePOs) {
      if (existingSet.has(po.poNumber)) {
        skipped.push(po.poNumber);
        continue;
      }
      const supplierId = supplierByName.get(po.vendor)!;
      const matchedLines = po.lineItems.filter(
        (li) => li.match.kind === "matched" && li.variantId,
      );
      if (matchedLines.length === 0) continue;

      await tx.purchaseOrder.create({
        data: {
          shop,
          poNumber: po.poNumber,
          status: po.status,
          supplierId,
          orderedAt: po.orderedAt,
          lineItems: {
            create: matchedLines.map((li) => ({
              shopifyVariantId: li.variantId!,
              shopifyProductId: li.productId || "",
              title: li.title,
              sku: li.sku,
              quantityOrdered: li.quantityOrdered,
              quantityReceived: 0,
              costPerUnit: li.costPerUnit,
            })),
          },
        },
      });
      createdPOCount++;
      createdLineItemCount += matchedLines.length;
    }

    return { createdPOCount, createdLineItemCount, skipped };
  });

  return {
    createdPOCount: result.createdPOCount,
    createdLineItemCount: result.createdLineItemCount,
    createdSupplierCount,
    reusedSupplierCount,
    skippedExistingPONumbers: result.skipped,
    includedAmountTotal: summary.includedAmountTotal,
    excludedAmountTotal: summary.excludedAmountTotal,
    excludedLineCount:
      summary.totalUnmatchedLines + summary.totalAmbiguousLines,
  };
}
