/**
 * Locale negotiation and locale-aware formatting.
 *
 * Two locales rendered in server components did not justify an i18n dependency:
 * there is no client bundle to ship, no runtime locale switching to coordinate,
 * and the Intl APIs already handle the parts that are genuinely hard — currency,
 * number and date formatting per locale. See docs/decisions/0005.
 */

export const LOCALES = ["en", "ja"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** BCP 47 tags used for Intl formatting, distinct from our short locale keys. */
const INTL_TAG: Record<Locale, string> = {
  en: "en-US",
  ja: "ja-JP",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Resolves the locale from an explicit choice first, then the browser's
 * Accept-Language header. An explicit ?lang= always wins, so a shared link
 * shows the same language to whoever opens it.
 */
export function resolveLocale(
  explicit: string | string[] | undefined,
  acceptLanguage: string | null,
): Locale {
  const requested = Array.isArray(explicit) ? explicit[0] : explicit;

  if (isLocale(requested)) {
    return requested;
  }

  if (!acceptLanguage) {
    return DEFAULT_LOCALE;
  }

  // Accept-Language: ja,en-US;q=0.9 — ordered by q, highest first.
  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const quality = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));

      return {
        base: (tag ?? "").trim().toLowerCase().split("-")[0] ?? "",
        quality: quality ? Number.parseFloat(quality.slice(2)) : 1,
      };
    })
    .filter((entry) => entry.base.length > 0 && !Number.isNaN(entry.quality))
    .sort((a, b) => b.quality - a.quality);

  for (const entry of ranked) {
    if (isLocale(entry.base)) {
      return entry.base;
    }
  }

  return DEFAULT_LOCALE;
}

export function formatMoney(
  amountMinor: number,
  currency: string,
  locale: Locale,
): string {
  // Minor units are exact; rounding would stop the tiles reconciling with the
  // ledger beneath them.
  return new Intl.NumberFormat(INTL_TAG[locale], {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

export function formatCount(value: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL_TAG[locale]).format(value);
}

export function formatFullDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatShortDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

/** Locale-aware "3 min ago" without shipping a date library. */
export function formatRelative(minutesAgo: number, locale: Locale): string {
  const formatter = new Intl.RelativeTimeFormat(INTL_TAG[locale], {
    numeric: "auto",
  });

  return minutesAgo < 60
    ? formatter.format(-minutesAgo, "minute")
    : formatter.format(-Math.round(minutesAgo / 60), "hour");
}
