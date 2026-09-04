import { headers } from "next/headers";

import { AppSidebar, BrandMark, primaryDestinations, ScrollableTable } from "@/components/app-shell";
import { MobileNav } from "@/components/mobile-nav";
import { WakeWatcher } from "@/components/wake-watcher";
import { CheckoutButton } from "@/components/checkout-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getSessionUser } from "@/lib/api-session";
import { probe, worstOf, type Reachability } from "@/lib/api-reachability";
import { getDictionary } from "@/i18n/dictionaries";
import {
  DEFAULT_LOCALE,
  formatCount,
  formatFullDate,
  formatMoney,
  formatRelative,
  formatShortDate,
  isLocale,
  type Locale,
} from "@/i18n/locale";
import { LOCALE_HEADER } from "@/proxy";

const API_BASE_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

type ApiHealth = {
  operational: boolean;
  /** How the request itself went, independent of what the answer said. */
  reachability: Reachability;
  /** Raw version string; the label around it is localised at render time. */
  version: string | null;
  /**
   * Tri-state on purpose. `null` means the API never answered, so we have no
   * information about the database — which is not the same as knowing it is
   * down, and must not be rendered as though it were.
   */
  databaseOperational: boolean | null;
  databaseLatencyMs: number | null;
  /**
   * Both null when the API predates reporting them — an older deployment has
   * not said these are missing, so the row is omitted rather than shown as
   * down. The count beneath the panel is derived from the rows that exist, so
   * it cannot claim a total the list does not contain.
   */
  clientOrigins: { configured: boolean; count: number | null } | null;
  errorTrackingConfigured: boolean | null;
  stripeConfigured: boolean;
  webhookConfigured: boolean;
};

/** What we know when the API did not answer: nothing. */
const unknownHealth = (reachability: Reachability): ApiHealth => ({
  operational: false,
  reachability,
  version: null,
  databaseOperational: reachability === "waking" ? null : false,
  databaseLatencyMs: null,
  stripeConfigured: false,
  webhookConfigured: false,
  clientOrigins: null,
  errorTrackingConfigured: null,
});

type DashboardTransaction = {
  id: string;
  customer: string;
  email: string;
  amountMinor: number;
  currency: string;
  /** Raw provider status; localised at render time, not at fetch time. */
  status: string;
  viaCheckout: boolean;
  minutesAgo: number;
  initials: string;
};

type TransactionResult = {
  data: DashboardTransaction[];
  source: "postgresql" | "unavailable";
  reachability: Reachability;
};

async function getApiHealth(): Promise<ApiHealth> {
  const result = await probe(`${API_BASE_URL}/api/v1/health`);

  if (result.reachability !== "reachable") {
    return unknownHealth(result.reachability);
  }

  try {
    const payload = (await result.response.json()) as {
      status?: unknown;
      version?: unknown;
      checks?: {
        database?: {
          status?: unknown;
          latencyMs?: unknown;
        };
        stripe?: { status?: unknown };
        webhook?: { status?: unknown };
        clientOrigins?: { status?: unknown; count?: unknown };
        errorTracking?: { status?: unknown };
      };
    };

    const apiOperational = payload.status === "operational" || payload.status === "degraded";
    const databaseOperational = payload.checks?.database?.status === "operational";
    const databaseLatency = payload.checks?.database?.latencyMs;

    return {
      operational: apiOperational,
      // It answered; if it reports itself unwell that is a real fault, not a
      // cold start.
      reachability: apiOperational ? "reachable" : "down",
      version: typeof payload.version === "string" ? payload.version : null,
      databaseOperational,
      databaseLatencyMs:
        databaseOperational && typeof databaseLatency === "number"
          ? databaseLatency
          : null,
      stripeConfigured: payload.checks?.stripe?.status === "configured",
      webhookConfigured: payload.checks?.webhook?.status === "configured",
      // null, not false: an API deployed before these were reported has not
      // told us they are missing, and "Down" would be a claim we cannot make.
      clientOrigins:
        payload.checks?.clientOrigins === undefined
          ? null
          : {
              configured: payload.checks.clientOrigins.status === "configured",
              count:
                typeof payload.checks.clientOrigins.count === "number"
                  ? payload.checks.clientOrigins.count
                  : null,
            },
      errorTrackingConfigured:
        payload.checks?.errorTracking === undefined
          ? null
          : payload.checks.errorTracking.status === "configured",
    };
  } catch {
    // The server answered and we could not read it. That is a genuine fault.
    return unknownHealth("down");
  }
}

async function getRecentTransactions(): Promise<TransactionResult> {
  const result = await probe(`${API_BASE_URL}/api/v1/transactions`);

  if (result.reachability !== "reachable") {
    return { data: [], source: "unavailable", reachability: result.reachability };
  }

  try {
    const payload = (await result.response.json()) as {
      data?: Array<{
        id?: unknown;
        customer?: { displayName?: unknown; email?: unknown };
        amountMinor?: unknown;
        currency?: unknown;
        status?: unknown;
        methodLabel?: unknown;
        createdAt?: unknown;
      }>;
      meta?: { source?: unknown };
    };

    if (!Array.isArray(payload.data) || payload.meta?.source !== "postgresql") {
      return { data: [], source: "unavailable", reachability: "down" };
    }

    const data = payload.data.flatMap((transaction) => {
      const id = transaction.id;
      const displayName = transaction.customer?.displayName;
      const email = transaction.customer?.email;
      const amountMinor = transaction.amountMinor;
      const currency = transaction.currency;
      const status = transaction.status;
      const methodLabel = transaction.methodLabel;
      const createdAt = transaction.createdAt;

      if (
        typeof id !== "string" ||
        typeof displayName !== "string" ||
        typeof email !== "string" ||
        typeof amountMinor !== "number" ||
        typeof currency !== "string" ||
        typeof status !== "string" ||
        typeof methodLabel !== "string" ||
        typeof createdAt !== "string"
      ) {
        return [];
      }

      const initials = displayName
        .split(" ")
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase();
      const minutesAgo = Math.max(
        0,
        Math.round((Date.now() - new Date(createdAt).getTime()) / 60_000),
      );

      return [
        {
          id,
          customer: displayName,
          email,
          amountMinor,
          currency,
          status,
          viaCheckout: methodLabel === "Stripe Checkout",
          minutesAgo,
          initials,
        },
      ];
    });

    return { data, source: "postgresql", reachability: "reachable" };
  } catch {
    return { data: [], source: "unavailable", reachability: "down" };
  }
}

type DashboardMetrics = {
  currency: string;
  grossVolumeMinor: number;
  succeededCount: number;
  successRate: number | null;
  pendingAmountMinor: number;
  pendingCount: number;
  eventsRecorded: number;
  dailyVolume: Array<{ date: string; amountMinor: number }>;
  live: boolean;
  reachability: Reachability;
};

const unavailableMetrics: DashboardMetrics = {
  currency: "JPY",
  grossVolumeMinor: 0,
  succeededCount: 0,
  successRate: null,
  pendingAmountMinor: 0,
  pendingCount: 0,
  eventsRecorded: 0,
  dailyVolume: [],
  live: false,
  reachability: "down",
};

async function getMetrics(): Promise<DashboardMetrics> {
  const result = await probe(`${API_BASE_URL}/api/v1/metrics`);

  if (result.reachability !== "reachable") {
    return { ...unavailableMetrics, reachability: result.reachability };
  }

  try {
    const payload = (await result.response.json()) as {
      currency?: unknown;
      grossVolumeMinor?: unknown;
      succeededCount?: unknown;
      successRate?: unknown;
      pending?: { amountMinor?: unknown; count?: unknown };
      eventsRecorded?: unknown;
      dailyVolume?: Array<{ date?: unknown; amountMinor?: unknown }>;
    };

    if (
      typeof payload.currency !== "string" ||
      typeof payload.grossVolumeMinor !== "number" ||
      typeof payload.succeededCount !== "number" ||
      typeof payload.eventsRecorded !== "number"
    ) {
      return unavailableMetrics;
    }

    return {
      currency: payload.currency,
      grossVolumeMinor: payload.grossVolumeMinor,
      succeededCount: payload.succeededCount,
      successRate:
        typeof payload.successRate === "number" ? payload.successRate : null,
      pendingAmountMinor:
        typeof payload.pending?.amountMinor === "number"
          ? payload.pending.amountMinor
          : 0,
      pendingCount:
        typeof payload.pending?.count === "number" ? payload.pending.count : 0,
      eventsRecorded: payload.eventsRecorded,
      reachability: "reachable",
      dailyVolume: Array.isArray(payload.dailyVolume)
        ? payload.dailyVolume.flatMap((bucket) =>
            typeof bucket.date === "string" && typeof bucket.amountMinor === "number"
              ? [{ date: bucket.date, amountMinor: bucket.amountMinor }]
              : [],
          )
        : [],
      live: true,
    };
  } catch {
    return unavailableMetrics;
  }
}



const STATUS_STYLES: Record<string, string> = {
  succeeded: "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
  processing: "border-sky-300/20 bg-sky-300/10 text-sky-200",
};

function StatusBadge({ status, label }: { status: string; label: string }) {
  const styles =
    STATUS_STYLES[status] ?? "border-amber-300/20 bg-amber-300/10 text-amber-200";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${styles}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string | string[]; lang?: string | string[] }>;
}) {
  const [apiHealth, transactionResult, paymentMetrics, query, requestHeaders] =
    await Promise.all([
      getApiHealth(),
      getRecentTransactions(),
      getMetrics(),
      searchParams,
      headers(),
    ]);
  // Negotiated once in middleware so the page and the <html lang> attribute
  // cannot disagree. See src/middleware.ts for the precedence rules.
  const negotiated = requestHeaders.get(LOCALE_HEADER);
  const locale: Locale = isLocale(negotiated) ? negotiated : DEFAULT_LOCALE;
  const t = getDictionary(locale);
  // Resolved for the header link only. Null (signed out, or API unreachable)
  // renders the sign-in door; the public page never depends on it.
  const sessionUser = await getSessionUser();
  const transactions = transactionResult.data;
  // One verdict for the page. `down` outranks `waking`: a reported fault is a
  // fact, and the absence of an answer is not.
  const reachability = worstOf([
    apiHealth.reachability,
    transactionResult.reachability,
    paymentMetrics.reachability,
  ]);
  const starting = reachability === "waking";
  const currency = paymentMetrics.currency;
  const metrics = [
    {
      label: t.metrics.grossVolume,
      value: formatMoney(paymentMetrics.grossVolumeMinor, currency, locale),
      note: t.metrics.succeededNote(formatCount(paymentMetrics.succeededCount, locale)),
      tone: "positive",
      glyph: "¥",
    },
    {
      label: t.metrics.succeededPayments,
      value: formatCount(paymentMetrics.succeededCount, locale),
      note:
        paymentMetrics.successRate === null
          ? t.metrics.noSettled
          : t.metrics.successRate(formatCount(paymentMetrics.successRate, locale)),
      tone: "positive",
      glyph: "✓",
    },
    {
      label: t.metrics.pendingSettlement,
      value: formatMoney(paymentMetrics.pendingAmountMinor, currency, locale),
      note: t.metrics.processingNote(formatCount(paymentMetrics.pendingCount, locale)),
      tone: "neutral",
      glyph: "↻",
    },
    {
      label: t.metrics.webhookEvents,
      value: formatCount(paymentMetrics.eventsRecorded, locale),
      note: t.metrics.deduplicated,
      tone: "positive",
      glyph: "⇄",
    },
  ];
  const peakDailyVolume = Math.max(
    1,
    ...paymentMetrics.dailyVolume.map((bucket) => bucket.amountMinor),
  );
  const axisLabels = [
    paymentMetrics.dailyVolume.at(0)?.date,
    paymentMetrics.dailyVolume.at(Math.floor(paymentMetrics.dailyVolume.length / 2))?.date,
    paymentMetrics.dailyVolume.at(-1)?.date,
  ].flatMap((date) =>
    date === undefined
      ? []
      : [formatShortDate(new Date(`${date}T00:00:00Z`), locale)],
  );
  const now = new Date();
  const greeting =
    now.getHours() < 12
      ? t.hero.morning
      : now.getHours() < 18
        ? t.hero.afternoon
        : t.hero.evening;
  const systemChecks = [
    {
      label: t.health.apiService,
      detail:
        apiHealth.version !== null
          ? `v${apiHealth.version}`
          : apiHealth.operational
            ? t.health.connected
            : starting
              ? t.health.startingDetail
              : t.health.unavailable,
      status: apiHealth.operational
        ? t.health.operational
        : starting
          ? t.health.starting
          : t.health.unavailable,
      healthy: apiHealth.operational,
    },
    {
      label: t.health.database,
      detail:
        apiHealth.databaseLatencyMs !== null
          ? `${formatCount(apiHealth.databaseLatencyMs, locale)} ms`
          : // No answer from the API means no information about the database.
            // Reporting "Unavailable" here would be diagnosing a system we never
            // reached.
            apiHealth.databaseOperational === null
            ? t.health.notYetReported
            : t.health.unavailable,
      status:
        apiHealth.databaseOperational === true
          ? t.health.operational
          : apiHealth.databaseOperational === null
            ? t.health.unknown
            : t.health.unavailable,
      healthy: apiHealth.databaseOperational === true,
    },
    {
      label: t.health.stripe,
      detail: apiHealth.stripeConfigured ? t.health.testApiAccess : t.health.awaitingKey,
      status: apiHealth.stripeConfigured ? t.health.configured : t.health.notConnected,
      healthy: apiHealth.stripeConfigured,
    },
    {
      label: t.health.webhook,
      detail: apiHealth.webhookConfigured
        ? t.health.signatureVerification
        : t.health.awaitingSecret,
      status: apiHealth.webhookConfigured ? t.health.configured : t.health.notConnected,
      healthy: apiHealth.webhookConfigured,
    },
    // Reported by the API since the return-URL allowlist landed, and shown
    // nowhere until now — the panel claimed "4 of 4" over a subset.
    ...(apiHealth.clientOrigins === null
      ? []
      : [
          {
            label: t.health.clientOrigins,
            detail:
              apiHealth.clientOrigins.count === null
                ? t.health.allowlistDetail
                : t.health.allowlistCount(String(apiHealth.clientOrigins.count)),
            status: apiHealth.clientOrigins.configured
              ? t.health.configured
              : t.health.notConnected,
            healthy: apiHealth.clientOrigins.configured,
          },
        ]),
    ...(apiHealth.errorTrackingConfigured === null
      ? []
      : [
          {
            label: t.health.errorTracking,
            detail: t.health.errorTrackingDetail,
            status: apiHealth.errorTrackingConfigured
              ? t.health.configured
              : t.health.notConnected,
            healthy: apiHealth.errorTrackingConfigured,
          },
        ]),
  ];
  const liveCheckCount = systemChecks.filter((check) => check.healthy).length;
  const checkoutStatus = Array.isArray(query.checkout)
    ? query.checkout[0]
    : query.checkout;

  return (
    <div className="min-h-screen bg-[#07110f] text-[#edf5f1]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_72%_-10%,rgba(52,211,153,0.11),transparent_35%),radial-gradient(circle_at_10%_90%,rgba(45,212,191,0.06),transparent_28%)]" />

      <AppSidebar t={t} active="overview" />

      <div className="relative lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-white/[0.07] bg-[#07110f]/80 px-5 py-4 backdrop-blur-xl sm:px-8 lg:px-10">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex items-center gap-3 lg:hidden">
              <MobileNav
                destinations={primaryDestinations(t)}
                active="overview"
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
              <p className="text-sm font-medium text-white/82">{t.header.overview}</p>
              <p className="mt-0.5 text-xs text-white/60">{formatFullDate(now, locale)}</p>
            </div>
            <div className="flex items-center gap-2.5 sm:gap-3">
              <span className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs text-white/50 md:flex">
                <span className={`size-1.5 rounded-full ${apiHealth.operational ? "bg-emerald-300 shadow-[0_0_8px_#6ee7b7]" : "bg-amber-300"}`} />
                {apiHealth.operational
                  ? t.header.apiConnected
                  : starting
                    ? t.header.apiStarting
                    : t.header.apiUnavailable}
              </span>
              <LanguageSwitcher
                locale={locale}
                label={t.header.languageLabel}
                toJapanese={t.header.switchToJapanese}
                toEnglish={t.header.switchToEnglish}
              />
              <CheckoutButton
                label={t.header.testPayment}
                loadingLabel={t.header.openingStripe}
                fallbackError={t.checkout.error}
                amountLabel={t.checkout.amountLabel}
                amountHint={t.checkout.amountHint}
                amountInvalid={t.checkout.amountInvalid}
              />
              {/* Plain <a>, not next/link, for the same reason as the language
                  switcher: /admin and /login are server-rendered from the
                  session cookie, and a full document request is what carries
                  it. */}
              <a
                href={sessionUser ? "/admin" : "/login"}
                className="rounded-xl border border-white/15 px-3.5 py-2.5 text-xs font-semibold text-white/80 transition hover:border-emerald-300/40 hover:text-white"
              >
                {sessionUser ? t.auth.adminConsole : t.auth.signIn}
              </a>
              <div className="grid size-9 place-items-center rounded-full border border-white/10 bg-[#16241f] text-xs font-semibold text-emerald-100">MF</div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
          {starting && <WakeWatcher copy={t.waking} />}

          {checkoutStatus && (
            <div
              className={`mb-5 rounded-xl border px-4 py-3 text-xs ${checkoutStatus === "success" ? "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100" : "border-amber-300/20 bg-amber-300/[0.08] text-amber-100"}`}
              role="status"
            >
              {checkoutStatus === "success" ? t.banner.success : t.banner.canceled}
            </div>
          )}
          <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-emerald-300/70">
                <span className="h-px w-5 bg-emerald-300/60" />
                {t.hero.eyebrow}
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">{greeting}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">{t.hero.blurb}</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/60">
              <span>{paymentMetrics.live ? t.hero.live : t.hero.unavailable}</span><span className="size-1 rounded-full bg-white/20" /><span>{t.hero.updated}</span>
            </div>
          </section>

          <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t.metrics.sectionLabel}>
            {metrics.map((metric, index) => (
              <article
                key={metric.label}
                style={{ "--anim-delay": `${index * 80}ms` } as React.CSSProperties}
                className="anim-rise group rounded-2xl border border-white/[0.075] bg-[#0d1a17]/85 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.16)] transition hover:-translate-y-0.5 hover:border-emerald-300/20"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-white/65">{metric.label}</p>
                    <p className="mt-2.5 text-2xl font-semibold tracking-[-0.03em] text-white">{metric.value}</p>
                  </div>
                  <span className="grid size-9 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.035] text-sm font-semibold text-emerald-200">{metric.glyph}</span>
                </div>
                <p className={`mt-3 text-xs ${metric.tone === "positive" ? "text-emerald-300/75" : "text-white/60"}`}>{metric.note}</p>
              </article>
            ))}
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
            <article className="rounded-2xl border border-white/[0.075] bg-[#0d1a17]/85 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.16)] sm:p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div>
                  <p className="text-sm font-medium text-white/88">{t.chart.title}</p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tracking-[-0.03em]">
                      {formatMoney(
                        paymentMetrics.dailyVolume.reduce((total, bucket) => total + bucket.amountMinor, 0),
                        currency,
                        locale,
                      )}
                    </span>
                    <span className="text-xs font-medium text-white/60">{t.chart.settled}</span>
                  </div>
                </div>
                <div className="inline-flex w-fit rounded-lg border border-white/[0.07] bg-black/10 px-2.5 py-1 text-[11px] text-white/60">
                  {t.chart.window(formatCount(paymentMetrics.dailyVolume.length || 12, locale))}
                </div>
              </div>
              <div className="mt-8 flex h-44 items-end gap-2 border-b border-white/[0.06] sm:gap-3">
                {paymentMetrics.dailyVolume.map((bucket, barIndex) => (
                  <div
                    key={bucket.date}
                    className="group relative flex h-full flex-1 items-end"
                    title={`${bucket.date}: ${formatMoney(bucket.amountMinor, currency, locale)}`}
                  >
                    <div
                      className="anim-grow w-full rounded-t-sm bg-gradient-to-t from-emerald-500/30 to-emerald-300/85 transition group-hover:from-emerald-400/50 group-hover:to-emerald-200"
                      style={{
                        height: `${Math.max(2, Math.round((bucket.amountMinor / peakDailyVolume) * 100))}%`,
                        "--anim-delay": `${200 + barIndex * 45}ms`,
                      } as React.CSSProperties}
                    />
                  </div>
                ))}
                {paymentMetrics.dailyVolume.length === 0 && (
                  <p className="w-full self-center text-center text-xs text-white/55">
                    {t.chart.unavailable}
                  </p>
                )}
              </div>
              <div className="mt-3 flex justify-between text-[10px] uppercase tracking-wider text-white/55">
                {axisLabels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </article>

            <article id="system-health" className="scroll-mt-24 rounded-2xl border border-white/[0.075] bg-[#0d1a17]/85 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.16)] sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white/88">{t.health.title}</p>
                  <p className="mt-1 text-xs text-white/60">{t.health.subtitle}</p>
                </div>
                <span className="rounded-full border border-amber-300/15 bg-amber-300/[0.07] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                  {t.health.liveCount(formatCount(liveCheckCount, locale), formatCount(systemChecks.length, locale))}
                </span>
              </div>
              {/* A list of statuses is a list: screen readers announce how many
                  there are, and the Vue and Svelte panels already say <ul>. */}
              <ul className="mt-5 divide-y divide-white/[0.06]">
                {systemChecks.map((check) => (
                  <li key={check.label} className="flex items-center justify-between gap-4 py-3.5 first:pt-0">
                    <div className="flex items-center gap-3">
                      <span className={`size-2 rounded-full ${check.healthy ? "bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.65)]" : "bg-white/20"}`} />
                      <div>
                        <p className="text-xs font-medium text-white/72">{check.label}</p>
                        <p className="mt-0.5 text-[10px] text-white/55">{check.detail}</p>
                      </div>
                    </div>
                    <span className={`text-[10px] ${check.healthy ? "text-emerald-300/70" : "text-white/55"}`}>{check.status}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-1 rounded-xl border border-white/[0.06] bg-black/10 p-3">
                <div className="flex items-center justify-between gap-3 text-[10px] text-white/60">
                  <span>{t.health.responseSource}</span>
                  <span className={`font-medium ${apiHealth.operational ? "text-emerald-300/75" : "text-amber-200/75"}`}>{apiHealth.operational ? t.health.liveEndpoint : starting ? t.health.startingState : t.health.fallbackState}</span>
                </div>
              </div>
            </article>
          </section>

          <section className="mt-4 overflow-hidden rounded-2xl border border-white/[0.075] bg-[#0d1a17]/85 shadow-[0_18px_60px_rgba(0,0,0,0.16)]">
            <div className="flex flex-col justify-between gap-3 border-b border-white/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:px-6">
              <div>
                <h2 className="text-sm font-medium text-white/88">{t.transactions.title}</h2>
                <p className="mt-1 text-xs text-white/60">
                  {transactionResult.source === "postgresql"
                    ? t.transactions.live
                    : t.transactions.unavailableSource}
                </p>
              </div>
              <span className="w-fit text-xs text-white/55">{t.transactions.showing}</span>
            </div>
            <ScrollableTable label={t.transactions.title}>
              <table className="w-full min-w-[760px] text-left">
                <thead>
                  <tr className="border-b border-white/[0.055] text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">
                    <th className="px-6 py-3 font-semibold">{t.transactions.customer}</th><th className="px-4 py-3 font-semibold">{t.transactions.amount}</th><th className="px-4 py-3 font-semibold">{t.transactions.method}</th><th className="px-4 py-3 font-semibold">{t.transactions.status}</th><th className="px-6 py-3 text-right font-semibold">{t.transactions.time}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {transactions.map((transaction) => (
                    <tr key={transaction.id} className="transition-colors hover:bg-white/[0.025]">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span className="grid size-8 place-items-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[10px] font-semibold text-emerald-100/75">{transaction.initials}</span>
                          <div><p className="text-xs font-medium text-white/78">{transaction.customer}</p><p className="mt-0.5 text-[10px] text-white/55">{transaction.email}</p></div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs font-semibold text-white/80">{formatMoney(transaction.amountMinor, transaction.currency, locale)}</td>
                      <td className="px-4 py-4 text-xs text-white/65">{transaction.viaCheckout ? t.transactions.stripeCheckout : t.transactions.sandboxCard}</td>
                      <td className="px-4 py-4">
                        <StatusBadge
                          status={transaction.status}
                          label={t.status[transaction.status as keyof typeof t.status] ?? transaction.status}
                        />
                      </td>
                      <td className="px-6 py-4 text-right text-xs text-white/60">{formatRelative(transaction.minutesAgo, locale)}</td>
                    </tr>
                  ))}
                  {transactions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-center text-xs text-white/60">
                        {t.transactions.empty}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollableTable>
          </section>

          <section className="mt-4 rounded-2xl border border-white/[0.075] bg-[#0d1a17]/70 px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">{t.flow.label}</p>
                <p className="mt-1.5 text-sm text-white/65">{t.flow.blurb}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/55 sm:gap-3">
                {t.flow.steps.map((step, index) => (
                  <div key={step} className="flex items-center gap-2 sm:gap-3">
                    <span className="rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 py-2">{step}</span>
                    {index < 4 && <span className="text-emerald-300/55">→</span>}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <footer className="mt-7 flex flex-col justify-between gap-2 border-t border-white/[0.05] pt-5 text-[10px] text-white/55 sm:flex-row">
            <span>
              {t.footer.left} · {t.footer.siblings}{" "}
              <a href="https://zerofayyz-fintech-vue.vercel.app">Vue 3</a> · <a href="https://zerofayyz-fintech-svelte.vercel.app">Svelte 5</a> · <a href="https://receipt-portal-one.vercel.app">Supabase receipt portal</a>
            </span>
            <span>{t.footer.right}</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
