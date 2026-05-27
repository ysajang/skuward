/**
 * Sanitize string input: trim and limit length
 */
export function sanitizeString(
  value: unknown,
  maxLength: number = 500,
): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

/**
 * Validate email format (loose check)
 */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Parse integer from form data with bounds
 */
export function parseIntSafe(
  value: unknown,
  defaultVal: number = 0,
  min: number = 0,
  max: number = 999999,
): number {
  const parsed = parseInt(String(value), 10);
  if (isNaN(parsed)) return defaultVal;
  return Math.max(min, Math.min(max, parsed));
}

/**
 * Parse decimal (cost/price) from form data
 */
export function parseDecimalSafe(
  value: unknown,
  defaultVal: number = 0,
): number {
  const parsed = parseFloat(String(value));
  if (isNaN(parsed) || parsed < 0) return defaultVal;
  return Math.round(parsed * 100) / 100;
}
