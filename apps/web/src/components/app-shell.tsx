import type { Dictionary } from "@/i18n/dictionaries";

/**
 * The application shell, shared by the public dashboard and the admin console.
 *
 * The console originally rendered as a bare centered column with none of the
 * platform's chrome — structurally a different product bolted onto the same
 * domain, and it read exactly that way. One shell, rendered by both pages,
 * with the sidebar marking where you are: primary sections on the left rail,
 * tabs inside a section. (Sidebar-for-sections, tabs-for-views is the pattern
 * the serious dashboards — Stripe, Linear, Vercel — all converge on.)
 */

export function BrandMark() {
  return (
    <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-300/25 bg-emerald-300/10 text-sm font-bold tracking-tight text-emerald-200 shadow-[0_0_30px_rgba(52,211,153,0.08)]">
      ZF
    </div>
  );
}

type SidebarProps = {
  t: Dictionary;
  active: "overview" | "admin" | "audit";
};

const PLANNED_KEYS = [
  { key: "payments", glyph: "↗" },
  { key: "transactions", glyph: "⇄" },
  { key: "customers", glyph: "◎" },
] as const;

function NavLink({
  href,
  glyph,
  label,
  current,
}: {
  href: string;
  glyph: string;
  label: string;
  current: boolean;
}) {
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
        current
          ? "bg-white/[0.08] font-medium text-white shadow-[inset_3px_0_0_#6ee7b7]"
          : "text-white/70 hover:bg-white/[0.05] hover:text-white"
      }`}
    >
      <span className="grid size-5 place-items-center text-sm text-emerald-200/80">{glyph}</span>
      {label}
    </a>
  );
}

function PlannedItem({ glyph, label, title }: { glyph: string; label: string; title: string }) {
  return (
    <button
      type="button"
      aria-disabled
      disabled
      title={title}
      className="flex w-full cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/55"
    >
      <span className="grid size-5 place-items-center text-sm text-emerald-200/70">{glyph}</span>
      {label}
    </button>
  );
}

export function AppSidebar({ t, active }: SidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-white/[0.07] bg-[#081310]/95 px-5 py-6 backdrop-blur-xl lg:flex lg:flex-col">
      <div className="flex items-center gap-3 px-1">
        <BrandMark />
        <div>
          <p className="text-sm font-semibold tracking-[0.08em] text-white">{t.brand.name}</p>
          <p className="text-[10px] font-medium tracking-[0.24em] text-emerald-300/70">{t.brand.suffix}</p>
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-emerald-100">{t.sandbox.label}</span>
          <span className="rounded-full bg-emerald-300/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">{t.sandbox.badge}</span>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-white/40">{t.sandbox.note}</p>
      </div>

      <nav className="mt-7 space-y-1" aria-label={t.nav.primaryLabel}>
        <NavLink href="/" glyph="⌂" label={t.nav.overview} current={active === "overview"} />
        {PLANNED_KEYS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-disabled
            disabled
            title={t.nav.plannedTitle}
            className="flex w-full cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/55"
          >
            <span className="grid size-5 place-items-center text-sm text-emerald-200/80">{item.glyph}</span>
            {t.nav[item.key]}
            <span className="ml-auto rounded-full border border-white/[0.07] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/55">
              {t.nav.planned}
            </span>
          </button>
        ))}
        {/* Real destinations now, not PLANNED badges: the console shipped. */}
        <NavLink href="/admin" glyph="◇" label={t.nav.admin} current={active === "admin"} />
      </nav>

      <div className="my-5 h-px bg-white/[0.06]" />

      <nav className="space-y-1" aria-label={t.nav.projectLabel}>
        <PlannedItem glyph="◉" label={t.nav.systemHealth} title={t.nav.plannedTitle} />
        <NavLink
          href="/admin?tab=audit"
          glyph="≡"
          label={t.nav.auditLog}
          current={active === "audit"}
        />
        <PlannedItem glyph="↗" label={t.nav.portfolioNotes} title={t.nav.plannedTitle} />
      </nav>

      <div className="mt-auto rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60">{t.build.label}</p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-white/65">{t.build.stage}</span>
          <span className="text-xs font-semibold text-emerald-300">{t.build.phase}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
          <div className="h-full w-[62%] rounded-full bg-gradient-to-r from-emerald-400 to-teal-300" />
        </div>
      </div>
    </aside>
  );
}
