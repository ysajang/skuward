import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing the module under test.
const deleteCalls: string[] = [];
vi.mock("../db.server", () => {
  const mk = (name: string) => ({
    deleteMany: vi.fn(async () => {
      deleteCalls.push(name);
      return { count: 0 };
    }),
  });
  return {
    default: {
      costRecord: mk("costRecord"),
      reorderRule: mk("reorderRule"),
      purchaseOrder: mk("purchaseOrder"),
      supplier: mk("supplier"),
      shopPlan: mk("shopPlan"),
      session: mk("session"),
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    },
  };
});

import { redactShopData } from "./compliance.server";

describe("redactShopData", () => {
  beforeEach(() => {
    deleteCalls.length = 0;
  });

  it("deletes all shop-scoped models for the given shop", async () => {
    await redactShopData("acme.myshopify.com");
    expect(deleteCalls).toContain("costRecord");
    expect(deleteCalls).toContain("reorderRule");
    expect(deleteCalls).toContain("purchaseOrder");
    expect(deleteCalls).toContain("supplier");
    expect(deleteCalls).toContain("shopPlan");
    expect(deleteCalls).toContain("session");
  });

  it("deletes purchase orders before suppliers (FK order)", async () => {
    await redactShopData("acme.myshopify.com");
    expect(deleteCalls.indexOf("purchaseOrder")).toBeLessThan(
      deleteCalls.indexOf("supplier"),
    );
  });
});
