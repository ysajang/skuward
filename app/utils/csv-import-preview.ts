/**
 * CSV import — preview aggregation (pure logic, no DB/Shopify).
 *
 * Given grouped POs and a sku->variant lookup result, classify each line
 * into matched / unmatched / ambiguous, compute included vs excluded totals,
 * and produce a preview summary the UI can render before confirming.
 */

import type { ParsedPO } from "./csv-import";

/** Result of looking up a single SKU against Shopify. */
export type SkuMatch =
  | { kind: "matched"; variantId: string; productId: string }
  | { kind: "unmatched" }
  | { kind: "ambiguous"; count: number };

/** Map of sku -> SkuMatch. Caller (server) builds this from Shopify. */
export type SkuMatchMap = Record<string, SkuMatch>;

export interface ResolvedLineItem {
  sku: string;
  title: string;
  quantityOrdered: number;
  costPerUnit: number;
  rowIndex: number;
  match: SkuMatch;
  variantId?: string;
  productId?: string;
}

export interface ResolvedPO {
  poNumber: string;
  vendor: string;
  status: ParsedPO["status"];
  orderedAt: Date | null;
  lineItems: ResolvedLineItem[];
  /** line items that will actually be created (matched only) */
  includedCount: number;
  /** line items skipped (unmatched + ambiguous) */
  excludedCount: number;
  includedAmount: number;
  excludedAmount: number;
}

export interface PreviewSummary {
  pos: ResolvedPO[];
  /** POs that have at least one matched line (will be created) */
  creatablePOCount: number;
  /** POs where every line was excluded (will NOT be created) */
  emptyPOCount: number;
  totalMatchedLines: number;
  totalUnmatchedLines: number;
  totalAmbiguousLines: number;
  includedAmountTotal: number;
  excludedAmountTotal: number;
  /** distinct vendors referenced by creatable POs */
  vendorsToEnsure: string[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Resolve grouped POs against a sku->match map into a preview summary.
 * Pure and deterministic. A PO with zero matched lines is marked empty
 * and excluded from creation (we never create an empty PO).
 */
export function buildPreviewSummary(
  pos: ParsedPO[],
  matches: SkuMatchMap,
): PreviewSummary {
  const resolvedPOs: ResolvedPO[] = [];
  let totalMatched = 0;
  let totalUnmatched = 0;
  let totalAmbiguous = 0;
  let includedTotal = 0;
  let excludedTotal = 0;
  let creatable = 0;
  let empty = 0;
  const vendorsToEnsure = new Set<string>();

  for (const po of pos) {
    const resolvedLines: ResolvedLineItem[] = [];
    let includedCount = 0;
    let excludedCount = 0;
    let includedAmount = 0;
    let excludedAmount = 0;

    for (const li of po.lineItems) {
      const match: SkuMatch = matches[li.sku] ?? { kind: "unmatched" };
      const lineAmount = round2(li.quantityOrdered * li.costPerUnit);

      const resolved: ResolvedLineItem = {
        sku: li.sku,
        title: li.title,
        quantityOrdered: li.quantityOrdered,
        costPerUnit: li.costPerUnit,
        rowIndex: li.rowIndex,
        match,
      };

      if (match.kind === "matched") {
        resolved.variantId = match.variantId;
        resolved.productId = match.productId;
        includedCount++;
        includedAmount = round2(includedAmount + lineAmount);
        totalMatched++;
      } else {
        excludedCount++;
        excludedAmount = round2(excludedAmount + lineAmount);
        if (match.kind === "unmatched") totalUnmatched++;
        else totalAmbiguous++;
      }

      resolvedLines.push(resolved);
    }

    const resolvedPO: ResolvedPO = {
      poNumber: po.poNumber,
      vendor: po.vendor,
      status: po.status,
      orderedAt: po.orderedAt,
      lineItems: resolvedLines,
      includedCount,
      excludedCount,
      includedAmount,
      excludedAmount,
    };

    if (includedCount > 0) {
      creatable++;
      vendorsToEnsure.add(po.vendor);
      includedTotal = round2(includedTotal + includedAmount);
    } else {
      empty++;
    }
    // excluded amount counts regardless (transparency)
    excludedTotal = round2(excludedTotal + excludedAmount);

    resolvedPOs.push(resolvedPO);
  }

  return {
    pos: resolvedPOs,
    creatablePOCount: creatable,
    emptyPOCount: empty,
    totalMatchedLines: totalMatched,
    totalUnmatchedLines: totalUnmatched,
    totalAmbiguousLines: totalAmbiguous,
    includedAmountTotal: includedTotal,
    excludedAmountTotal: excludedTotal,
    vendorsToEnsure: Array.from(vendorsToEnsure),
  };
}
