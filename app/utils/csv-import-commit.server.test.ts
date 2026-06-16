import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks must be declared before importing the module under test ---
const mockState: any = {
  plan: "STARTER",
  existingPOs: [] as Array<{ poNumber: string }>,
  existingSuppliers: [] as Array<{ id: string; name: string }>,
  createdPOs: [] as any[],
  createdSuppliers: [] as any[],
};

vi.mock("./billing.server", () => ({
  getShopPlan: vi.fn(async () => mockState.plan),
}));

vi.mock("../db.server", () => {
  const tx = {
    supplier: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `sup_${mockState.createdSuppliers.length + 1}`, name: data.name };
        mockState.createdSuppliers.push(row);
        return row;
      }),
    },
    purchaseOrder: {
      create: vi.fn(async ({ data }: any) => {
        mockState.createdPOs.push(data);
        return { id: `po_${mockState.createdPOs.length}` };
      }),
    },
  };
  return {
    default: {
      purchaseOrder: {
        findMany: vi.fn(async () => mockState.existingPOs),
        create: tx.purchaseOrder.create,
      },
      supplier: {
        findMany: vi.fn(async () => mockState.existingSuppliers),
        create: tx.supplier.create,
      },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    },
  };
});

import { commitImport, canCommitImport, ImportGatingError } from "./csv-import-commit.server";
import type { PreviewSummary } from "./csv-import-preview";

function matchedLine(sku: string, qty: number, cost: number) {
  return {
    sku,
    title: sku,
    quantityOrdered: qty,
    costPerUnit: cost,
    rowIndex: 0,
    match: { kind: "matched" as const, variantId: `gid_${sku}`, productId: `p_${sku}` },
    variantId: `gid_${sku}`,
    productId: `p_${sku}`,
  };
}

function summary(pos: any[]): PreviewSummary {
  return {
    pos,
    creatablePOCount: pos.filter((p) => p.includedCount > 0).length,
    emptyPOCount: pos.filter((p) => p.includedCount === 0).length,
    totalMatchedLines: 0,
    totalUnmatchedLines: 0,
    totalAmbiguousLines: 0,
    includedAmountTotal: 0,
    excludedAmountTotal: 0,
    vendorsToEnsure: Array.from(new Set(pos.map((p) => p.vendor))),
  };
}

beforeEach(() => {
  mockState.plan = "STARTER";
  mockState.existingPOs = [];
  mockState.existingSuppliers = [];
  mockState.createdPOs = [];
  mockState.createdSuppliers = [];
});

describe("canCommitImport", () => {
  it("FREE cannot, STARTER/PRO can", () => {
    expect(canCommitImport("FREE")).toBe(false);
    expect(canCommitImport("STARTER")).toBe(true);
    expect(canCommitImport("PRO")).toBe(true);
  });
});

describe("commitImport gating", () => {
  it("throws ImportGatingError for FREE plan", async () => {
    mockState.plan = "FREE";
    const s = summary([
      { poNumber: "PO-1", vendor: "Acme", status: "DRAFT", orderedAt: null, includedCount: 1, excludedCount: 0, includedAmount: 10, excludedAmount: 0, lineItems: [matchedLine("A", 1, 10)] },
    ]);
    await expect(commitImport("shop.myshopify.com", s)).rejects.toBeInstanceOf(ImportGatingError);
    expect(mockState.createdPOs.length).toBe(0);
  });
});

describe("commitImport behavior", () => {
  it("creates suppliers (new) and POs with matched lines", async () => {
    const s = summary([
      { poNumber: "PO-1", vendor: "Acme", status: "ORDERED", orderedAt: null, includedCount: 2, excludedCount: 0, includedAmount: 0, excludedAmount: 0, lineItems: [matchedLine("A", 1, 10), matchedLine("B", 2, 5)] },
    ]);
    const r = await commitImport("shop", s);
    expect(r.createdPOCount).toBe(1);
    expect(r.createdLineItemCount).toBe(2);
    expect(r.createdSupplierCount).toBe(1);
    expect(r.reusedSupplierCount).toBe(0);
    expect(mockState.createdPOs[0].lineItems.create.length).toBe(2);
  });

  it("reuses existing supplier by name (no duplicate create)", async () => {
    mockState.existingSuppliers = [{ id: "sup_existing", name: "Acme" }];
    const s = summary([
      { poNumber: "PO-1", vendor: "Acme", status: "DRAFT", orderedAt: null, includedCount: 1, excludedCount: 0, includedAmount: 0, excludedAmount: 0, lineItems: [matchedLine("A", 1, 10)] },
    ]);
    const r = await commitImport("shop", s);
    expect(r.createdSupplierCount).toBe(0);
    expect(r.reusedSupplierCount).toBe(1);
    expect(mockState.createdPOs[0].supplierId).toBe("sup_existing");
  });

  it("skips POs whose poNumber already exists for the shop", async () => {
    mockState.existingPOs = [{ poNumber: "PO-1" }];
    const s = summary([
      { poNumber: "PO-1", vendor: "Acme", status: "DRAFT", orderedAt: null, includedCount: 1, excludedCount: 0, includedAmount: 0, excludedAmount: 0, lineItems: [matchedLine("A", 1, 10)] },
      { poNumber: "PO-2", vendor: "Acme", status: "DRAFT", orderedAt: null, includedCount: 1, excludedCount: 0, includedAmount: 0, excludedAmount: 0, lineItems: [matchedLine("B", 1, 10)] },
    ]);
    const r = await commitImport("shop", s);
    expect(r.createdPOCount).toBe(1);
    expect(r.skippedExistingPONumbers).toEqual(["PO-1"]);
    expect(mockState.createdPOs.length).toBe(1);
    expect(mockState.createdPOs[0].poNumber).toBe("PO-2");
  });

  it("does not create empty POs (no matched lines)", async () => {
    const s = summary([
      { poNumber: "PO-3", vendor: "Beta", status: "DRAFT", orderedAt: null, includedCount: 0, excludedCount: 1, includedAmount: 0, excludedAmount: 50, lineItems: [] },
    ]);
    const r = await commitImport("shop", s);
    expect(r.createdPOCount).toBe(0);
    expect(mockState.createdSuppliers.length).toBe(0);
  });

  it("shares one supplier across multiple POs of same vendor", async () => {
    const s = summary([
      { poNumber: "PO-1", vendor: "Acme", status: "DRAFT", orderedAt: null, includedCount: 1, excludedCount: 0, includedAmount: 0, excludedAmount: 0, lineItems: [matchedLine("A", 1, 1)] },
      { poNumber: "PO-2", vendor: "Acme", status: "DRAFT", orderedAt: null, includedCount: 1, excludedCount: 0, includedAmount: 0, excludedAmount: 0, lineItems: [matchedLine("B", 1, 1)] },
    ]);
    const r = await commitImport("shop", s);
    expect(r.createdSupplierCount).toBe(1);
    expect(mockState.createdPOs.length).toBe(2);
    expect(mockState.createdPOs[0].supplierId).toBe(mockState.createdPOs[1].supplierId);
  });
});
