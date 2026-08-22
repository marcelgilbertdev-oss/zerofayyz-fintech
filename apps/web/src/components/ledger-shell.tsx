import { headers } from "next/headers";
import Link from "next/link";

import { AppSidebar, BrandMark, primaryDestinations } from "@/components/app-shell";
import { MobileNav } from "@/components/mobile-nav";
import { getDictionary, type Dictionary } from "@/i18n/dictionaries";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locale";
import { LOCALE_HEADER } from "@/proxy";

/**
 * Shared scaffolding for the three ledger pages. One place decides the frame —
 * shell, header, table chrome, pagination — so the pages stay thin and cannot
 * drift apart visually.
 */

export async function resolvePage(): Promise<{ t: Dictionary; locale: Locale }> {
  const requested = (await headers()).get(LOCALE_HEADER);
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;

  return { t: getDictionary(locale), locale };
}

export function LedgerFrame({
  t,
  active,
  title,
  subtitle,
  children,
}: {
  t: Dictionary;
  active: "payments" | "transactions" | "customers";
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#07110f] text-[#edf5f1]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_72%_-10%,rgba(52,211,153,0.11),transparent_35%),radial-gradient(circle_at_10%_90%,rgba(45,212,191,0.06),transparent_28%)]" />

      <AppSidebar t={t} active={active} />

      <div className="relative lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-white/[0.07] bg-[#07110f]/80 px-5 py-4 backdrop-blur-xl sm:px-8 lg:px-10">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex items-center gap-3 lg:hidden">
              <MobileNav
                destinations={primaryDestinations(t)}
                active={active}
                labels={{
                  primaryLabel: t.nav.primaryLabel,
                  closeMenu: t.nav.closeMenu,
                  brandName: t.brand.name,
                  brandSuffix: t.brand.suffix,
                  portfolioNotes: t.nav.portfolioNotes,
                }}
              />
              <BrandMark />
              <div>
                <p className="text-xs font-semibold tracking-[0.08em]">{t.brand.name}</p>
                <p className="text-[9px] tracking-[0.22em] text-emerald-300/70">{t.brand.suffix}</p>
              </div>
            </div>
            <div className="hidden sm:block">
              <h1 className="text-sm font-medium text-white/82">{title}</h1>
              <p className="mt-0.5 max-w-2xl text-xs leading-5 text-white/60">{subtitle}</p>
            </div>
            <Link
              href="/"
              className="rounded-xl border border-white/15 px-3.5 py-2.5 text-xs font-semibold text-white/80 transition hover:border-emerald-300/40 hover:text-white"
            >
              {t.nav.overview}
            </Link>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Server-rendered pagination: plain links, so back/forward and sharing work. */
export function Pagination({
  t,
  basePath,
  query,
  limit,
  offset,
  total,
}: {
  t: Dictionary;
  basePath: string;
  query: Record<string, string>;
  limit: number;
  offset: number;
  total: number;
}) {
  const href = (nextOffset: number) => {
    const parameters = new URLSearchParams({ ...query, offset: String(nextOffset) });

    return `${basePath}?${parameters.toString()}`;
  };

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const link =
    "rounded-xl border border-white/15 px-3.5 py-2 text-xs font-semibold text-white/80 transition hover:border-emerald-300/40 hover:text-white";
  const disabled =
    "cursor-not-allowed rounded-xl border border-white/[0.06] px-3.5 py-2 text-xs font-semibold text-white/30";

  return (
    <div className="mt-5 flex items-center justify-between gap-3">
      <p className="text-xs text-white/50">{t.pages.pagination.showing(from, to, total)}</p>
      <div className="flex gap-2">
        {offset > 0 ? (
          <a href={href(Math.max(0, offset - limit))} className={link}>
            {t.pages.pagination.previous}
          </a>
        ) : (
          <span aria-disabled className={disabled}>
            {t.pages.pagination.previous}
          </span>
        )}
        {offset + limit < total ? (
          <a href={href(offset + limit)} className={link}>
            {t.pages.pagination.next}
          </a>
        ) : (
          <span aria-disabled className={disabled}>
            {t.pages.pagination.next}
          </span>
        )}
      </div>
    </div>
  );
}

export const LEDGER_TABLE = "w-full text-left text-xs";
export const LEDGER_THEAD = "bg-white/[0.04] text-[10px] uppercase tracking-wider text-white/50";
export const LEDGER_TBODY = "divide-y divide-white/5";

export async function fetchLedger<T>(path: string): Promise<T | null> {
  const apiUrl = process.env.API_URL ?? "http://127.0.0.1:4000";

  try {
    const response = await fetch(`${apiUrl}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(
        Number.parseInt(process.env.API_TIMEOUT_MS ?? "15000", 10),
      ),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}
