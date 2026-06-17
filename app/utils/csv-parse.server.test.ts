import { describe, it, expect } from "vitest";
import { parseCsv, CsvEmptyError } from "./csv-parse.server";

describe("parseCsv", () => {
  it("parses headers and records, trimming values", () => {
    const csv = "PO, Vendor , SKU\nPO-1, Acme , A1\nPO-1,Acme,A2\n";
    const r = parseCsv(csv);
    expect(r.headers).toEqual(["PO", "Vendor", "SKU"]);
    expect(r.records.length).toBe(2);
    expect(r.records[0]).toEqual({ PO: "PO-1", Vendor: "Acme", SKU: "A1" });
    expect(r.truncated).toBe(false);
  });

  it("drops fully-empty rows", () => {
    const csv = "PO,SKU\nPO-1,A1\n\n,\nPO-2,A2\n";
    const r = parseCsv(csv);
    expect(r.records.length).toBe(2);
  });

  it("throws on missing header", () => {
    expect(() => parseCsv("")).toThrow(CsvEmptyError);
  });

  it("throws when header present but no data rows", () => {
    expect(() => parseCsv("PO,SKU\n")).toThrow(CsvEmptyError);
  });

  it("handles quoted fields with commas", () => {
    const csv = 'PO,Vendor,SKU\nPO-1,"Acme, Inc.",A1\n';
    const r = parseCsv(csv);
    expect(r.records[0].Vendor).toBe("Acme, Inc.");
  });
});
