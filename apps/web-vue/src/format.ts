/** Locale-aware formatting via Intl — no date/number library needed. */

export function money(amountMinor: number, currency: string): string {
  // Minor units are exact; rounding would stop tiles reconciling with the ledger.
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    amountMinor / 100,
  );
}

export function relative(iso: string): string {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60_000),
  );
  const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

  return minutes < 60
    ? formatter.format(-minutes, "minute")
    : formatter.format(-Math.round(minutes / 60), "hour");
}
