import { describe, it, expect } from "vitest";
import {
  STARTER_PLAN,
  PRO_PLAN,
  BILLING_PLANS,
  planNameToPlanType,
  resolvePlanFromSubscriptions,
  buildReturnUrl,
  isDevStore,
} from "./billing.server";

describe("planNameToPlanType", () => {
  it("maps known plan names to PlanType", () => {
    expect(planNameToPlanType(STARTER_PLAN)).toBe("STARTER");
    expect(planNameToPlanType(PRO_PLAN)).toBe("PRO");
  });
  it("maps unknown/undefined to FREE", () => {
    expect(planNameToPlanType("Nonexistent")).toBe("FREE");
    expect(planNameToPlanType(undefined)).toBe("FREE");
  });
});

describe("BILLING_PLANS config", () => {
  it("has STARTER $9.99 and PRO $19.99, both Every30Days, USD", () => {
    expect(BILLING_PLANS[STARTER_PLAN].amount).toBe(9.99);
    expect(BILLING_PLANS[PRO_PLAN].amount).toBe(19.99);
    expect(BILLING_PLANS[STARTER_PLAN].currencyCode).toBe("USD");
    expect(BILLING_PLANS[PRO_PLAN].currencyCode).toBe("USD");
  });
});

describe("resolvePlanFromSubscriptions", () => {
  it("returns FREE when no active subscriptions", () => {
    expect(resolvePlanFromSubscriptions([])).toEqual({
      plan: "FREE",
      chargeId: null,
    });
  });
  it("returns the matching plan + charge id for a single active sub", () => {
    expect(
      resolvePlanFromSubscriptions([{ name: STARTER_PLAN, id: "gid://1" }]),
    ).toEqual({ plan: "STARTER", chargeId: "gid://1" });
  });
  it("prefers the highest tier when multiple active (PRO > STARTER)", () => {
    expect(
      resolvePlanFromSubscriptions([
        { name: STARTER_PLAN, id: "gid://1" },
        { name: PRO_PLAN, id: "gid://2" },
      ]),
    ).toEqual({ plan: "PRO", chargeId: "gid://2" });
  });
  it("ignores subscriptions with unknown names", () => {
    expect(
      resolvePlanFromSubscriptions([{ name: "Legacy", id: "gid://9" }]),
    ).toEqual({ plan: "FREE", chargeId: null });
  });
});

describe("isDevStore", () => {
  it("true for skuward-dev, false otherwise", () => {
    expect(isDevStore("skuward-dev.myshopify.com")).toBe(true);
    expect(isDevStore("realstore.myshopify.com")).toBe(false);
  });
});

describe("buildReturnUrl", () => {
  it("builds admin app deep-link when handle present", () => {
    expect(buildReturnUrl("acme.myshopify.com", "skuward")).toBe(
      "https://admin.shopify.com/store/acme/apps/skuward",
    );
  });
  it("falls back to /app when handle missing", () => {
    expect(buildReturnUrl("acme.myshopify.com")).toBe("/app");
  });
});
