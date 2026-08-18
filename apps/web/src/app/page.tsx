type ApiHealth = {
  operational: boolean;
  detail: string;
  databaseOperational: boolean;
  databaseDetail: string;
};

async function getApiHealth(): Promise<ApiHealth> {
  const apiUrl = process.env.API_URL ?? "http://127.0.0.1:4000";

  try {
    const response = await fetch(`${apiUrl}/api/v1/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });

    if (!response.ok) {
      return {
        operational: false,
        detail: `HTTP ${response.status}`,
        databaseOperational: false,
        databaseDetail: "Unavailable",
      };
    }

    const payload = (await response.json()) as {
      status?: unknown;
      version?: unknown;
      checks?: {
        database?: {
          status?: unknown;
          latencyMs?: unknown;
        };
      };
    };

    const apiOperational = payload.status === "operational" || payload.status === "degraded";
    const databaseOperational = payload.checks?.database?.status === "operational";
    const databaseLatency = payload.checks?.database?.latencyMs;

    return {
      operational: apiOperational,
      detail: typeof payload.version === "string" ? `v${payload.version}` : "Connected",
      databaseOperational,
      databaseDetail:
        databaseOperational && typeof databaseLatency === "number"
          ? `${databaseLatency} ms`
          : "Unavailable",
    };
  } catch {
    return {
      operational: false,
      detail: "Unavailable",
      databaseOperational: false,
      databaseDetail: "Unavailable",
    };
  }
}

const navItems = [
  { label: "Overview", glyph: "⌂", active: true },
  { label: "Payments", glyph: "↗" },
  { label: "Transactions", glyph: "⇄" },
  { label: "Customers", glyph: "◎" },
  { label: "Admin console", glyph: "◇" },
];

const secondaryNav = [
  { label: "System health", glyph: "◉" },
  { label: "Audit log", glyph: "≡" },
  { label: "Portfolio notes", glyph: "↗" },
];

const metrics = [
  { label: "Gross volume", value: "$48,920", note: "+12.4% vs last month", tone: "positive", glyph: "$" },
  { label: "Successful payments", value: "1,284", note: "98.7% success rate", tone: "positive", glyph: "✓" },
  { label: "Pending settlement", value: "$3,840", note: "8 transfers processing", tone: "neutral", glyph: "↻" },
  { label: "Dispute rate", value: "0.18%", note: "Within healthy range", tone: "positive", glyph: "↓" },
];

const chartBars = [42, 58, 49, 72, 66, 83, 61, 78, 91, 76, 86, 96];

const transactions = [
  { customer: "Nadia Al-Sabah", email: "nadia@example.test", amount: "$420.00", method: "Visa •••• 4242", status: "Succeeded", time: "2 min ago", initials: "NA" },
  { customer: "Omar Rahman", email: "omar@example.test", amount: "$185.50", method: "Mastercard •••• 8210", status: "Processing", time: "18 min ago", initials: "OR" },
  { customer: "Leila Haddad", email: "leila@example.test", amount: "$760.00", method: "Visa •••• 1044", status: "Succeeded", time: "42 min ago", initials: "LH" },
  { customer: "Yousef Karim", email: "yousef@example.test", amount: "$92.40", method: "Visa •••• 0091", status: "Review", time: "1 hr ago", initials: "YK" },
];

function BrandMark() {
  return (
    <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-300/25 bg-emerald-300/10 text-sm font-bold tracking-tight text-emerald-200 shadow-[0_0_30px_rgba(52,211,153,0.08)]">
      ZF
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles = status === "Succeeded"
    ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
    : status === "Processing"
      ? "border-sky-300/20 bg-sky-300/10 text-sky-200"
      : "border-amber-300/20 bg-amber-300/10 text-amber-200";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${styles}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

export default async function Home() {
  const apiHealth = await getApiHealth();
  const systemChecks = [
    {
      label: "API service",
      detail: apiHealth.detail,
      status: apiHealth.operational ? "Operational" : "Unavailable",
      healthy: apiHealth.operational,
    },
    {
      label: "PostgreSQL",
      detail: apiHealth.databaseDetail,
      status: apiHealth.databaseOperational ? "Operational" : "Unavailable",
      healthy: apiHealth.databaseOperational,
    },
    { label: "Stripe sandbox", detail: "Awaiting test keys", status: "Not connected", healthy: false },
    { label: "Webhook queue", detail: "Not configured", status: "Not connected", healthy: false },
  ];

  return (
    <div className="min-h-screen bg-[#07110f] text-[#edf5f1]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_72%_-10%,rgba(52,211,153,0.11),transparent_35%),radial-gradient(circle_at_10%_90%,rgba(45,212,191,0.06),transparent_28%)]" />

      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-white/[0.07] bg-[#081310]/95 px-5 py-6 backdrop-blur-xl lg:flex lg:flex-col">
        <div className="flex items-center gap-3 px-1">
          <BrandMark />
          <div>
            <p className="text-sm font-semibold tracking-[0.08em] text-white">ZEROFAYYZ</p>
            <p className="text-[10px] font-medium tracking-[0.24em] text-emerald-300/70">FINTECH</p>
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-emerald-100">Sandbox</span>
            <span className="rounded-full bg-emerald-300/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">Test mode</span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-white/40">Simulated portfolio environment</p>
        </div>

        <nav className="mt-7 space-y-1" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              key={item.label}
              type="button"
              aria-current={item.active ? "page" : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${item.active ? "bg-white/[0.08] font-medium text-white shadow-[inset_3px_0_0_#6ee7b7]" : "text-white/48 hover:bg-white/[0.04] hover:text-white/80"}`}
            >
              <span className="grid size-5 place-items-center text-sm text-emerald-200/80">{item.glyph}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="my-5 h-px bg-white/[0.06]" />

        <nav className="space-y-1" aria-label="Project navigation">
          {secondaryNav.map((item) => (
            <button key={item.label} type="button" className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/48 transition-colors hover:bg-white/[0.04] hover:text-white/80">
              <span className="grid size-5 place-items-center text-sm text-emerald-200/70">{item.glyph}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">Portfolio build</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-white/65">MVP foundation</span>
            <span className="text-xs font-semibold text-emerald-300">Phase 1</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full w-[28%] rounded-full bg-gradient-to-r from-emerald-400 to-teal-300" />
          </div>
        </div>
      </aside>

      <div className="relative lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-white/[0.07] bg-[#07110f]/80 px-5 py-4 backdrop-blur-xl sm:px-8 lg:px-10">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
            <div className="flex items-center gap-3 lg:hidden">
              <BrandMark />
              <div>
                <p className="text-xs font-semibold tracking-[0.08em]">ZEROFAYYZ</p>
                <p className="text-[9px] tracking-[0.22em] text-emerald-300/70">FINTECH</p>
              </div>
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-medium text-white/82">Operations overview</p>
              <p className="mt-0.5 text-xs text-white/35">Tuesday, 18 August 2026</p>
            </div>
            <div className="flex items-center gap-2.5 sm:gap-3">
              <span className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs text-white/50 md:flex">
                <span className={`size-1.5 rounded-full ${apiHealth.operational ? "bg-emerald-300 shadow-[0_0_8px_#6ee7b7]" : "bg-amber-300"}`} />
                {apiHealth.operational ? "API connected" : "API unavailable"}
              </span>
              <button type="button" className="rounded-xl bg-emerald-300 px-4 py-2.5 text-xs font-semibold text-[#062018] shadow-[0_10px_30px_rgba(52,211,153,0.12)] transition hover:bg-emerald-200">+ Test payment</button>
              <div className="grid size-9 place-items-center rounded-full border border-white/10 bg-[#16241f] text-xs font-semibold text-emerald-100">MF</div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
          <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-emerald-300/70">
                <span className="h-px w-5 bg-emerald-300/60" />
                Payment operations
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">Good morning, Marcel.</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/42">Monitor the sandbox payment lifecycle, review recent activity, and verify platform health from one workspace.</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/35">
              <span>Demo data</span><span className="size-1 rounded-full bg-white/20" /><span>Updated just now</span>
            </div>
          </section>

          <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key metrics">
            {metrics.map((metric) => (
              <article key={metric.label} className="group rounded-2xl border border-white/[0.075] bg-[#0d1a17]/85 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.16)] transition hover:-translate-y-0.5 hover:border-emerald-300/20">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-white/42">{metric.label}</p>
                    <p className="mt-2.5 text-2xl font-semibold tracking-[-0.03em] text-white">{metric.value}</p>
                  </div>
                  <span className="grid size-9 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.035] text-sm font-semibold text-emerald-200">{metric.glyph}</span>
                </div>
                <p className={`mt-3 text-xs ${metric.tone === "positive" ? "text-emerald-300/75" : "text-white/35"}`}>{metric.note}</p>
              </article>
            ))}
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
            <article className="rounded-2xl border border-white/[0.075] bg-[#0d1a17]/85 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.16)] sm:p-6">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                <div>
                  <p className="text-sm font-medium text-white/88">Payment volume</p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold tracking-[-0.03em]">$48,920</span>
                    <span className="text-xs font-medium text-emerald-300">+12.4%</span>
                  </div>
                </div>
                <div className="inline-flex w-fit rounded-lg border border-white/[0.07] bg-black/10 p-1 text-[11px] text-white/38">
                  <span className="rounded-md px-2.5 py-1">7D</span>
                  <span className="rounded-md bg-white/[0.08] px-2.5 py-1 font-medium text-white/80">30D</span>
                  <span className="rounded-md px-2.5 py-1">90D</span>
                </div>
              </div>
              <div className="mt-8 flex h-44 items-end gap-2 border-b border-white/[0.06] sm:gap-3">
                {chartBars.map((height, index) => (
                  <div key={`${height}-${index}`} className="group relative flex h-full flex-1 items-end">
                    <div className="w-full rounded-t-sm bg-gradient-to-t from-emerald-500/30 to-emerald-300/85 transition group-hover:from-emerald-400/50 group-hover:to-emerald-200" style={{ height: `${height}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-between text-[10px] uppercase tracking-wider text-white/25">
                <span>Jul 20</span><span>Jul 27</span><span>Aug 03</span><span>Aug 10</span><span>Aug 18</span>
              </div>
            </article>

            <article className="rounded-2xl border border-white/[0.075] bg-[#0d1a17]/85 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.16)] sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white/88">System health</p>
                  <p className="mt-1 text-xs text-white/34">Real integration status</p>
                </div>
                <span className="rounded-full border border-amber-300/15 bg-amber-300/[0.07] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                  {apiHealth.databaseOperational ? "2 of 4 live" : "1 of 4 live"}
                </span>
              </div>
              <div className="mt-5 divide-y divide-white/[0.06]">
                {systemChecks.map((check) => (
                  <div key={check.label} className="flex items-center justify-between gap-4 py-3.5 first:pt-0">
                    <div className="flex items-center gap-3">
                      <span className={`size-2 rounded-full ${check.healthy ? "bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.65)]" : "bg-white/20"}`} />
                      <div>
                        <p className="text-xs font-medium text-white/72">{check.label}</p>
                        <p className="mt-0.5 text-[10px] text-white/28">{check.detail}</p>
                      </div>
                    </div>
                    <span className={`text-[10px] ${check.healthy ? "text-emerald-300/70" : "text-white/30"}`}>{check.status}</span>
                  </div>
                ))}
              </div>
              <div className="mt-1 rounded-xl border border-white/[0.06] bg-black/10 p-3">
                <div className="flex items-center justify-between gap-3 text-[10px] text-white/35">
                  <span>API response source</span>
                  <span className={`font-medium ${apiHealth.operational ? "text-emerald-300/75" : "text-amber-200/75"}`}>{apiHealth.operational ? "Live endpoint" : "Fallback state"}</span>
                </div>
              </div>
            </article>
          </section>

          <section className="mt-4 overflow-hidden rounded-2xl border border-white/[0.075] bg-[#0d1a17]/85 shadow-[0_18px_60px_rgba(0,0,0,0.16)]">
            <div className="flex flex-col justify-between gap-3 border-b border-white/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:px-6">
              <div>
                <h2 className="text-sm font-medium text-white/88">Recent transactions</h2>
                <p className="mt-1 text-xs text-white/34">Sandbox payment activity across test customers</p>
              </div>
              <button type="button" className="w-fit text-xs font-medium text-emerald-300 hover:text-emerald-200">View all transactions →</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead>
                  <tr className="border-b border-white/[0.055] text-[10px] font-semibold uppercase tracking-[0.12em] text-white/28">
                    <th className="px-6 py-3 font-semibold">Customer</th><th className="px-4 py-3 font-semibold">Amount</th><th className="px-4 py-3 font-semibold">Payment method</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-6 py-3 text-right font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {transactions.map((transaction) => (
                    <tr key={transaction.email} className="transition-colors hover:bg-white/[0.025]">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span className="grid size-8 place-items-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[10px] font-semibold text-emerald-100/75">{transaction.initials}</span>
                          <div><p className="text-xs font-medium text-white/78">{transaction.customer}</p><p className="mt-0.5 text-[10px] text-white/28">{transaction.email}</p></div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs font-semibold text-white/80">{transaction.amount}</td>
                      <td className="px-4 py-4 text-xs text-white/42">{transaction.method}</td>
                      <td className="px-4 py-4"><StatusBadge status={transaction.status} /></td>
                      <td className="px-6 py-4 text-right text-xs text-white/32">{transaction.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-white/[0.075] bg-[#0d1a17]/70 px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/32">MVP payment flow</p>
                <p className="mt-1.5 text-sm text-white/65">A visible, testable path from checkout to financial record.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/55 sm:gap-3">
                {["Next.js app", "Backend API", "Stripe sandbox", "Webhook event", "PostgreSQL"].map((step, index) => (
                  <div key={step} className="flex items-center gap-2 sm:gap-3">
                    <span className="rounded-lg border border-white/[0.07] bg-white/[0.035] px-3 py-2">{step}</span>
                    {index < 4 && <span className="text-emerald-300/55">→</span>}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <footer className="mt-7 flex flex-col justify-between gap-2 border-t border-white/[0.05] pt-5 text-[10px] text-white/25 sm:flex-row">
            <span>ZEROFAYYZ FINTECH · Portfolio Prototype</span>
            <span>Sandbox data only · No real funds processed</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
