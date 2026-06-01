import { describe, it, expect } from "vitest";
import { countNetNew } from "./net-new";

describe("countNetNew", () => {
  it("counts only ids not already present", () => {
    const existing = new Set(["v1", "v2"]);
    expect(countNetNew(["v1", "v3", "v4"], existing)).toBe(2); // v3, v4
  });
  it("returns 0 when all already exist", () => {
    expect(countNetNew(["v1", "v2"], new Set(["v1", "v2"]))).toBe(0);
  });
  it("dedupes the incoming list before counting", () => {
    expect(countNetNew(["v3", "v3", "v4"], new Set())).toBe(2);
  });
  it("counts all when none exist", () => {
    expect(countNetNew(["a", "b", "c"], new Set())).toBe(3);
  });
});
