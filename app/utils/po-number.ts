/**
 * Generate a PO number in format: PO-YYYYMMDD-XXXX
 * where XXXX is a random 4-digit hex string
 */
export function generatePONumber(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `PO-${y}${m}${d}-${rand}`;
}
