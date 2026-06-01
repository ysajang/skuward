import { describe, it, expect } from "vitest";
import { monthRange } from "./month-range";

describe("monthRange", () => {
  it("returns [first day 00:00, next month first day 00:00) UTC for a mid-month date", () => {
    const { start, end } = monthRange(new Date("2026-06-15T13:45:00.000Z"));
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("handles year rollover (December -> January)", () => {
    const { start, end } = monthRange(new Date("2026-12-31T23:59:59.000Z"));
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("includes the first instant of the month and excludes the next month's first instant", () => {
    const { start, end } = monthRange(new Date("2026-02-01T00:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});
