/**
 * CSV parsing (server-only) using papaparse.
 * Returns headers + records; enforces a row cap to defend against huge uploads.
 */

import Papa from "papaparse";
import { MAX_ROWS } from "./csv-import";

export interface ParsedCsv {
  headers: string[];
  records: Record<string, string>[];
  truncated: boolean;
  parseErrors: string[];
}

const MAX_BYTES = 5 * 1024 * 1024; // 5MB hard cap

export class CsvTooLargeError extends Error {
  constructor() {
    super("CSV file exceeds the 5MB limit");
    this.name = "CsvTooLargeError";
  }
}

export class CsvEmptyError extends Error {
  constructor(msg = "CSV has no data rows") {
    super(msg);
    this.name = "CsvEmptyError";
  }
}

/**
 * Parse raw CSV text into headers + record objects.
 * - header row required
 * - values coerced to string and trimmed by papaparse config
 * - rows beyond MAX_ROWS are dropped (truncated=true)
 */
export function parseCsv(text: string): ParsedCsv {
  if (text.length > MAX_BYTES) throw new CsvTooLargeError();

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });

  const headers = (result.meta.fields ?? []).filter((h) => h && h.length > 0);
  if (headers.length === 0) {
    throw new CsvEmptyError("CSV header row is missing or empty");
  }

  let records = (result.data ?? []).filter(
    (r) => r && Object.values(r).some((v) => v != null && String(v).trim() !== ""),
  );

  const truncated = records.length > MAX_ROWS;
  if (truncated) records = records.slice(0, MAX_ROWS);

  if (records.length === 0) throw new CsvEmptyError();

  const parseErrors = (result.errors ?? [])
    .slice(0, 20)
    .map((e) => `row ${e.row ?? "?"}: ${e.message}`);

  return { headers, records, truncated, parseErrors };
}
