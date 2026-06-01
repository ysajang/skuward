import { describe, it, expect } from "vitest";
import {
  getPlanLimits,
  canCreatePO,
  canCreateSupplier,
  canCreateReorderRule,
  canAccessCOGS,
} from "./plan-limits";

describe("getPlanLimits", () => {
  it("FREE: PO 5/mo, 2 suppliers, 3 reorder rules, COGS locked", () => {
    const f = getPlanLimits("FREE");
    expect(f.maxPOsPerMonth).toBe(5);
    expect(f.maxSuppliers).toBe(2);
    expect(f.maxReorderRules).toBe(3);
    expect(f.cogsTracking).toBe(false);
  });

  it("STARTER: unlimited PO, 10 suppliers, unlimited reorder rules, COGS unlocked", () => {
    const s = getPlanLimits("STARTER");
    expect(s.maxPOsPerMonth).toBe(Infinity);
    expect(s.maxSuppliers).toBe(10);
    expect(s.maxReorderRules).toBe(Infinity);
    expect(s.cogsTracking).toBe(true);
  });

  it("PRO: everything unlimited + margin report + csv export", () => {
    const p = getPlanLimits("PRO");
    expect(p.maxPOsPerMonth).toBe(Infinity);
    expect(p.maxSuppliers).toBe(Infinity);
    expect(p.maxReorderRules).toBe(Infinity);
    expect(p.cogsTracking).toBe(true);
    expect(p.marginReport).toBe(true);
    expect(p.csvExport).toBe(true);
  });
});

describe("canCreatePO", () => {
  it("FREE blocks at 5", () => {
    expect(canCreatePO("FREE", 4)).toBe(true);
    expect(canCreatePO("FREE", 5)).toBe(false);
    expect(canCreatePO("FREE", 6)).toBe(false);
  });
  it("STARTER never blocks", () => {
    expect(canCreatePO("STARTER", 9999)).toBe(true);
  });
});

describe("canCreateSupplier", () => {
  it("FREE blocks at 2", () => {
    expect(canCreateSupplier("FREE", 1)).toBe(true);
    expect(canCreateSupplier("FREE", 2)).toBe(false);
  });
  it("STARTER blocks at 10", () => {
    expect(canCreateSupplier("STARTER", 9)).toBe(true);
    expect(canCreateSupplier("STARTER", 10)).toBe(false);
  });
  it("PRO never blocks", () => {
    expect(canCreateSupplier("PRO", 9999)).toBe(true);
  });
});

describe("canCreateReorderRule", () => {
  it("FREE blocks at 3", () => {
    expect(canCreateReorderRule("FREE", 2)).toBe(true);
    expect(canCreateReorderRule("FREE", 3)).toBe(false);
  });
  it("STARTER never blocks", () => {
    expect(canCreateReorderRule("STARTER", 9999)).toBe(true);
  });
});

describe("canAccessCOGS", () => {
  it("FREE locked, STARTER/PRO unlocked", () => {
    expect(canAccessCOGS("FREE")).toBe(false);
    expect(canAccessCOGS("STARTER")).toBe(true);
    expect(canAccessCOGS("PRO")).toBe(true);
  });
});
