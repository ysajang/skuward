import { describe, it, expect } from "vitest";
import {
  autoGuessMapping,
  missingRequiredFields,
  parseMoney,
  parseQuantity,
  parseStatus,
  parseDate,
  sanitizeText,
  groupRowsIntoPOs,
  type ColumnMapping,
} from "./csv-import";

describe("autoGuessMapping", () => {
  it("maps common Stocky-ish headers", () => {
    const m = autoGuessMapping([
      "PO Number",
      "Vendor",
      "SKU",
      "Product Name",
      "Quantity",
      "Unit Cost",
      "Status",
      "Date",
    ]);
    expect(m.poNumber).toBe("PO Number");
    expect(m.vendor).toBe("Vendor");
    expect(m.sku).toBe("SKU");
    expect(m.title).toBe("Product Name");
    expect(m.quantity).toBe("Quantity");
    expect(m.costPerUnit).toBe("Unit Cost");
    expect(m.status).toBe("Status");
    expect(m.orderedAt).toBe("Date");
  });

  it("handles underscores / casing", () => {
    const m = autoGuessMapping(["po_number", "supplier_name", "qty", "cost_price"]);
    expect(m.poNumber).toBe("po_number");
    expect(m.vendor).toBe("supplier_name");
    expect(m.quantity).toBe("qty");
    expect(m.costPerUnit).toBe("cost_price");
  });

  it("does not double-assign one header to two fields", () => {
    // "price" could match costPerUnit; ensure only one field claims it
    const m = autoGuessMapping(["po", "vendor", "sku", "qty", "price"]);
    const headers = Object.values(m);
    expect(new Set(headers).size).toBe(headers.length);
  });

  it("leaves unknown headers unmapped", () => {
    const m = autoGuessMapping(["foo", "bar"]);
    expect(Object.keys(m).length).toBe(0);
  });
});

describe("missingRequiredFields", () => {
  it("reports all missing when empty", () => {
    expect(missingRequiredFields({})).toEqual([
      "poNumber",
      "vendor",
      "sku",
      "quantity",
      "costPerUnit",
    ]);
  });

  it("returns empty when all required present", () => {
    const m: ColumnMapping = {
      poNumber: "a",
      vendor: "b",
      sku: "c",
      quantity: "d",
      costPerUnit: "e",
    };
    expect(missingRequiredFields(m)).toEqual([]);
  });
});

describe("parseMoney", () => {
  it("plain number", () => {
    expect(parseMoney("12.50")).toBe(12.5);
  });
  it("strips currency symbol and thousands comma", () => {
    expect(parseMoney("$1,234.56")).toBe(1234.56);
    expect(parseMoney("₩12,000")).toBe(12000);
  });
  it("euro-style decimal comma", () => {
    expect(parseMoney("1.234,56")).toBe(1234.56);
    expect(parseMoney("12,50")).toBe(12.5);
  });
  it("rounds to 2 decimals", () => {
    expect(parseMoney("1.005")).toBe(1.01);
  });
  it("rejects negatives and junk", () => {
    expect(parseMoney("-5")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });
});

describe("parseQuantity", () => {
  it("parses ints", () => {
    expect(parseQuantity("10")).toBe(10);
    expect(parseQuantity("1,000")).toBe(1000);
  });
  it("truncates decimals", () => {
    expect(parseQuantity("3.9")).toBe(3);
  });
  it("rejects negatives and junk", () => {
    expect(parseQuantity("-1")).toBeNull();
    expect(parseQuantity("x")).toBeNull();
    expect(parseQuantity("")).toBeNull();
  });
});

describe("parseStatus", () => {
  it("maps known statuses", () => {
    expect(parseStatus("ordered")).toBe("ORDERED");
    expect(parseStatus("Received")).toBe("RECEIVED");
    expect(parseStatus("partially received")).toBe("PARTIALLY_RECEIVED");
    expect(parseStatus("cancelled")).toBe("CANCELLED");
  });
  it("defaults to DRAFT for unknown/empty", () => {
    expect(parseStatus("whatever")).toBe("DRAFT");
    expect(parseStatus("")).toBe("DRAFT");
    expect(parseStatus(null)).toBe("DRAFT");
  });
});

describe("parseDate", () => {
  it("parses ISO", () => {
    const d = parseDate("2026-01-15");
    expect(d).toBeInstanceOf(Date);
    expect(d?.getUTCFullYear()).toBe(2026);
  });
  it("returns null for junk", () => {
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("sanitizeText", () => {
  it("collapses whitespace and trims", () => {
    expect(sanitizeText("  a   b  ")).toBe("a b");
  });
  it("caps length", () => {
    expect(sanitizeText("a".repeat(10), 5)).toBe("aaaaa");
  });
});

describe("groupRowsIntoPOs", () => {
  const mapping: ColumnMapping = {
    poNumber: "PO",
    vendor: "Vendor",
    sku: "SKU",
    title: "Title",
    quantity: "Qty",
    costPerUnit: "Cost",
    status: "Status",
    orderedAt: "Date",
  };

  it("groups multiple rows with same PO into one PO with many line items", () => {
    const records = [
      { PO: "PO-1", Vendor: "Acme", SKU: "A1", Title: "Widget", Qty: "5", Cost: "10.00", Status: "ordered", Date: "2026-01-01" },
      { PO: "PO-1", Vendor: "Acme", SKU: "A2", Title: "Gadget", Qty: "2", Cost: "20.00", Status: "ordered", Date: "2026-01-01" },
      { PO: "PO-2", Vendor: "Beta", SKU: "B1", Title: "Thing", Qty: "1", Cost: "5.00", Status: "draft", Date: "" },
    ];
    const r = groupRowsIntoPOs(records, mapping);
    expect(r.pos.length).toBe(2);
    const po1 = r.pos.find((p) => p.poNumber === "PO-1")!;
    expect(po1.lineItems.length).toBe(2);
    expect(po1.vendor).toBe("Acme");
    expect(po1.status).toBe("ORDERED");
    expect(po1.orderedAt).toBeInstanceOf(Date);
    expect(r.vendors.sort()).toEqual(["Acme", "Beta"]);
  });

  it("collects invalid rows into rowErrors without throwing", () => {
    const records = [
      { PO: "PO-1", Vendor: "Acme", SKU: "A1", Title: "OK", Qty: "5", Cost: "10", Status: "", Date: "" },
      { PO: "", Vendor: "Acme", SKU: "A2", Title: "no po", Qty: "5", Cost: "10", Status: "", Date: "" },
      { PO: "PO-3", Vendor: "", SKU: "A3", Title: "no vendor", Qty: "5", Cost: "10", Status: "", Date: "" },
      { PO: "PO-4", Vendor: "Acme", SKU: "", Title: "no sku", Qty: "5", Cost: "10", Status: "", Date: "" },
      { PO: "PO-5", Vendor: "Acme", SKU: "A5", Title: "bad qty", Qty: "0", Cost: "10", Status: "", Date: "" },
      { PO: "PO-6", Vendor: "Acme", SKU: "A6", Title: "bad cost", Qty: "5", Cost: "abc", Status: "", Date: "" },
    ];
    const r = groupRowsIntoPOs(records, mapping);
    expect(r.pos.length).toBe(1);
    expect(r.rowErrors.map((e) => e.rowIndex).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("falls back title to sku when title missing", () => {
    const records = [
      { PO: "PO-1", Vendor: "Acme", SKU: "A1", Title: "", Qty: "5", Cost: "10", Status: "", Date: "" },
    ];
    const r = groupRowsIntoPOs(records, mapping);
    expect(r.pos[0].lineItems[0].title).toBe("A1");
  });

  it("first-wins vendor for same PO number", () => {
    const records = [
      { PO: "PO-1", Vendor: "Acme", SKU: "A1", Title: "x", Qty: "1", Cost: "1", Status: "", Date: "" },
      { PO: "PO-1", Vendor: "OtherVendor", SKU: "A2", Title: "y", Qty: "1", Cost: "1", Status: "", Date: "" },
    ];
    const r = groupRowsIntoPOs(records, mapping);
    expect(r.pos.length).toBe(1);
    expect(r.pos[0].vendor).toBe("Acme");
  });
});
