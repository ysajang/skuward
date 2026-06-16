import { describe, it, expect } from "vitest";
import { buildPreviewSummary, type SkuMatchMap } from "./csv-import-preview";
import type { ParsedPO } from "./csv-import";

function po(poNumber: string, vendor: string, lines: Array<[string, number, number]>): ParsedPO {
  return {
    poNumber,
    vendor,
    status: "DRAFT",
    orderedAt: null,
    lineItems: lines.map(([sku, qty, cost], i) => ({
      sku,
      title: sku,
      quantityOrdered: qty,
      costPerUnit: cost,
      rowIndex: i,
    })),
  };
}

describe("buildPreviewSummary", () => {
  it("classifies matched / unmatched / ambiguous and computes amounts", () => {
    const pos = [po("PO-1", "Acme", [["A1", 5, 10], ["A2", 2, 20], ["A3", 1, 100]])];
    const matches: SkuMatchMap = {
      A1: { kind: "matched", variantId: "v1", productId: "p1" },
      A2: { kind: "unmatched" },
      A3: { kind: "ambiguous", count: 2 },
    };
    const s = buildPreviewSummary(pos, matches);

    expect(s.totalMatchedLines).toBe(1);
    expect(s.totalUnmatchedLines).toBe(1);
    expect(s.totalAmbiguousLines).toBe(1);
    expect(s.includedAmountTotal).toBe(50); // 5*10
    expect(s.excludedAmountTotal).toBe(140); // 2*20 + 1*100
    expect(s.creatablePOCount).toBe(1);
    expect(s.emptyPOCount).toBe(0);
    expect(s.vendorsToEnsure).toEqual(["Acme"]);

    const li = s.pos[0].lineItems.find((l) => l.sku === "A1")!;
    expect(li.variantId).toBe("v1");
    expect(li.productId).toBe("p1");
  });

  it("marks a PO with zero matches as empty and excludes it from creation", () => {
    const pos = [po("PO-2", "Beta", [["X1", 1, 5], ["X2", 2, 5]])];
    const matches: SkuMatchMap = {
      X1: { kind: "unmatched" },
      X2: { kind: "unmatched" },
    };
    const s = buildPreviewSummary(pos, matches);
    expect(s.creatablePOCount).toBe(0);
    expect(s.emptyPOCount).toBe(1);
    expect(s.includedAmountTotal).toBe(0);
    expect(s.excludedAmountTotal).toBe(15);
    expect(s.vendorsToEnsure).toEqual([]);
  });

  it("treats sku absent from match map as unmatched", () => {
    const pos = [po("PO-3", "Gamma", [["Z9", 1, 9]])];
    const s = buildPreviewSummary(pos, {});
    expect(s.totalUnmatchedLines).toBe(1);
    expect(s.creatablePOCount).toBe(0);
  });

  it("partial PO: some lines matched, some excluded -> PO is creatable, excluded tracked", () => {
    const pos = [po("PO-4", "Delta", [["M1", 3, 10], ["U1", 1, 50]])];
    const matches: SkuMatchMap = {
      M1: { kind: "matched", variantId: "v", productId: "p" },
      U1: { kind: "unmatched" },
    };
    const s = buildPreviewSummary(pos, matches);
    expect(s.creatablePOCount).toBe(1);
    expect(s.pos[0].includedCount).toBe(1);
    expect(s.pos[0].excludedCount).toBe(1);
    expect(s.pos[0].includedAmount).toBe(30);
    expect(s.pos[0].excludedAmount).toBe(50);
  });

  it("aggregates distinct vendors across multiple creatable POs", () => {
    const pos = [
      po("PO-5", "Acme", [["A", 1, 1]]),
      po("PO-6", "Acme", [["B", 1, 1]]),
      po("PO-7", "Beta", [["C", 1, 1]]),
    ];
    const matches: SkuMatchMap = {
      A: { kind: "matched", variantId: "v", productId: "p" },
      B: { kind: "matched", variantId: "v", productId: "p" },
      C: { kind: "matched", variantId: "v", productId: "p" },
    };
    const s = buildPreviewSummary(pos, matches);
    expect(s.vendorsToEnsure.sort()).toEqual(["Acme", "Beta"]);
    expect(s.creatablePOCount).toBe(3);
  });
});
