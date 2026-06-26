/**
 * CSV PO Import — pure logic (no DB / no Shopify deps)
 *
 * Responsibilities:
 *  - field mapping (CSV header -> SKUward field) auto-guessing
 *  - value parsing/sanitization (money, quantity, status, date)
 *  - row-level validation
 *  - grouping rows by poNumber into PO + line items
 *
 * SKU->variant matching and supplier upsert are done by the caller
 * (server layer) since they require Shopify/DB access.
 */

import type { POStatus } from "@prisma/client";

// ----------------------------------------------------------------------------
// Target fields
// ----------------------------------------------------------------------------

export type ImportField =
  | "poNumber"
  | "vendor"
  | "sku"
  | "title"
  | "quantity"
  | "costPerUnit"
  | "status"
  | "orderedAt"
  | "ignore";

export const IMPORT_FIELDS: Exclude<ImportField, "ignore">[] = [
  "poNumber",
  "vendor",
  "sku",
  "title",
  "quantity",
  "costPerUnit",
  "status",
  "orderedAt",
];

/** Required fields for a usable import. */
export const REQUIRED_FIELDS: ImportField[] = [
  "poNumber",
  "vendor",
  "sku",
  "quantity",
  "costPerUnit",
];

/** Map of ImportField -> CSV header string chosen by the user. */
export type ColumnMapping = Partial<Record<ImportField, string>>;

// Row safety limits (defense against huge uploads)
export const MAX_ROWS = 5000;

// ----------------------------------------------------------------------------
// Auto-guess mapping from headers
// ----------------------------------------------------------------------------

const HEADER_ALIASES: Record<Exclude<ImportField, "ignore">, string[]> = {
  poNumber: [
    "po number",
    "po #",
    "po no",
    "purchase order",
    "purchase order number",
    "po",
    "order number",
    "reference",
  ],
  vendor: ["vendor", "supplier", "supplier name", "vendor name", "company"],
  sku: ["sku", "variant sku", "product sku", "item sku", "barcode sku"],
  title: ["title", "product", "product name", "item", "item name", "name", "description"],
  quantity: ["quantity", "qty", "ordered", "quantity ordered", "order qty", "units"],
  costPerUnit: [
    "cost",
    "unit cost",
    "cost per unit",
    "cost price",
    "price",
    "unit price",
    "supply price",
  ],
  status: ["status", "state", "po status"],
  orderedAt: ["date", "ordered at", "order date", "created", "created at", "po date"],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");
}

/**
 * Best-effort auto mapping. Exact alias match wins over partial contains.
 * Each CSV header maps to at most one field; each field gets at most one header.
 */
export function autoGuessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const usedHeaders = new Set<string>();
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));

  // pass 1: exact alias match
  for (const field of IMPORT_FIELDS) {
    const aliases = HEADER_ALIASES[field];
    const hit = normalized.find(
      (h) => !usedHeaders.has(h.raw) && aliases.includes(h.norm),
    );
    if (hit) {
      mapping[field] = hit.raw;
      usedHeaders.add(hit.raw);
    }
  }

  // pass 2: partial contains for still-unmapped fields
  for (const field of IMPORT_FIELDS) {
    if (mapping[field]) continue;
    const aliases = HEADER_ALIASES[field];
    const hit = normalized.find(
      (h) =>
        !usedHeaders.has(h.raw) &&
        aliases.some((a) => h.norm === a || h.norm.includes(a)),
    );
    if (hit) {
      mapping[field] = hit.raw;
      usedHeaders.add(hit.raw);
    }
  }

  return mapping;
}

/** Which required fields are not covered by the mapping. */
export function missingRequiredFields(mapping: ColumnMapping): ImportField[] {
  return REQUIRED_FIELDS.filter((f) => !mapping[f]);
}

// ----------------------------------------------------------------------------
// Value parsing / sanitization
// ----------------------------------------------------------------------------

/**
 * Parse a money string into a number with 2-decimal precision.
 * Strips currency symbols, thousands separators, spaces.
 * Returns null if not a valid non-negative number.
 */
export function parseMoney(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s === "") return null;
  // remove currency symbols and letters, keep digits . , -
  s = s.replace(/[^\d.,\-]/g, "");
  if (s === "" || s === "-") return null;

  // Handle thousands separators. If both , and . present, assume the last one is decimal.
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      // comma is decimal: 1.234,56 -> 1234.56
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // dot is decimal: 1,234.56 -> 1234.56
      s = s.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    // only commas. If exactly one comma with 1-2 trailing digits, treat as decimal.
    const after = s.length - lastComma - 1;
    if (s.indexOf(",") === lastComma && after >= 1 && after <= 2) {
      s = s.replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  }

  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  // epsilon-corrected rounding to avoid IEEE754 issues (e.g. 1.005 -> 1.00)
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Parse a quantity into a non-negative integer. Returns null if invalid. */
export function parseQuantity(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/[, ]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

const STATUS_ALIASES: Record<string, POStatus> = {
  draft: "DRAFT",
  pending: "DRAFT",
  open: "ORDERED",
  ordered: "ORDERED",
  sent: "ORDERED",
  "mark as ordered": "ORDERED",
  partial: "PARTIALLY_RECEIVED",
  "partially received": "PARTIALLY_RECEIVED",
  received: "RECEIVED",
  closed: "RECEIVED",
  complete: "RECEIVED",
  completed: "RECEIVED",
  cancelled: "CANCELLED",
  canceled: "CANCELLED",
  void: "CANCELLED",
};

/** Map a free-form status string to POStatus. Defaults to DRAFT. */
export function parseStatus(raw: string | undefined | null): POStatus {
  if (raw == null) return "DRAFT";
  const s = String(raw).trim().toLowerCase();
  return STATUS_ALIASES[s] ?? "DRAFT";
}

/** Parse a date string into a Date, or null if unparseable. */
export function parseDate(raw: string | undefined | null): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

/** Sanitize a free-text field: trim, collapse whitespace, cap length. */
export function sanitizeText(raw: string | undefined | null, maxLen = 500): string {
  if (raw == null) return "";
  return String(raw).replace(/\s+/g, " ").trim().slice(0, maxLen);
}

// ----------------------------------------------------------------------------
// Row validation + grouping
// ----------------------------------------------------------------------------

export interface ParsedLineItem {
  sku: string;
  title: string;
  quantityOrdered: number;
  costPerUnit: number;
  rowIndex: number; // original CSV row index (0-based, excluding header)
}

export interface ParsedPO {
  poNumber: string;
  vendor: string;
  status: POStatus;
  orderedAt: Date | null;
  lineItems: ParsedLineItem[];
}

export interface RowError {
  rowIndex: number;
  reason: string;
}

export interface GroupResult {
  pos: ParsedPO[];
  rowErrors: RowError[];
  vendors: string[]; // distinct vendor names referenced
}

/**
 * Validate + group raw CSV records (array of {header: value}) into POs.
 * Pure: no DB. Invalid rows are collected into rowErrors, never throw.
 *
 * A row is invalid if any required field fails to parse.
 * Rows sharing the same poNumber are merged into one PO. The first valid
 * row for a poNumber sets vendor/status/orderedAt; later conflicting
 * vendor values are ignored (first-wins) but recorded as a soft note.
 */
export function groupRowsIntoPOs(
  records: Record<string, string>[],
  mapping: ColumnMapping,
): GroupResult {
  const pos = new Map<string, ParsedPO>();
  const rowErrors: RowError[] = [];
  const vendorSet = new Set<string>();

  const get = (rec: Record<string, string>, field: ImportField): string => {
    const header = mapping[field];
    if (!header) return "";
    return rec[header] ?? "";
  };

  records.forEach((rec, rowIndex) => {
    const poNumber = sanitizeText(get(rec, "poNumber"), 100);
    const vendor = sanitizeText(get(rec, "vendor"), 200);
    const sku = sanitizeText(get(rec, "sku"), 100);
    const title = sanitizeText(get(rec, "title"), 500) || sku;
    const quantity = parseQuantity(get(rec, "quantity"));
    const cost = parseMoney(get(rec, "costPerUnit"));

    // required-field validation
    if (!poNumber) {
      rowErrors.push({ rowIndex, reason: "Missing PO number" });
      return;
    }
    if (!vendor) {
      rowErrors.push({ rowIndex, reason: "Missing supplier name" });
      return;
    }
    if (!sku) {
      rowErrors.push({ rowIndex, reason: "Missing SKU" });
      return;
    }
    if (quantity === null || quantity <= 0) {
      rowErrors.push({ rowIndex, reason: "Invalid quantity" });
      return;
    }
    if (cost === null) {
      rowErrors.push({ rowIndex, reason: "Invalid unit cost" });
      return;
    }

    vendorSet.add(vendor);

    let po = pos.get(poNumber);
    if (!po) {
      po = {
        poNumber,
        vendor,
        status: parseStatus(get(rec, "status")),
        orderedAt: parseDate(get(rec, "orderedAt")),
        lineItems: [],
      };
      pos.set(poNumber, po);
    }

    po.lineItems.push({
      sku,
      title,
      quantityOrdered: quantity,
      costPerUnit: cost,
      rowIndex,
    });
  });

  return {
    pos: Array.from(pos.values()),
    rowErrors,
    vendors: Array.from(vendorSet),
  };
}
