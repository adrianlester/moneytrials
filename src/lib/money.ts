/** Money is pence everywhere. These are the only two places it becomes a string. */

export function gbp(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence);
  return `${sign}£${(abs / 100).toFixed(2)}`;
}

/** Short form for tight mobile rows: £95, £3.60 */
export function gbpShort(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence);
  return abs % 100 === 0 ? `${sign}£${abs / 100}` : `${sign}£${(abs / 100).toFixed(2)}`;
}

/** Accepts "12", "12.50", "£12.50". Returns pence, or null if it isn't money. */
export function parsePounds(input: string): number | null {
  const cleaned = input.trim().replace(/^£/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}
