import type { ReactNode } from "react";

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

/**
 * A horizontally scrollable table container that a keyboard can actually reach.
 *
 * These wrappers scroll at narrow widths, and a scroll container that is not
 * focusable strands keyboard users at whatever the viewport happens to show —
 * axe's `scrollable-region-focusable`, a WCAG A failure. It shipped undetected
 * because the accessibility suite only ran at desktop width, where the tables
 * do not overflow and therefore do not scroll. The suite now runs at a phone
 * viewport too, which is what surfaced it.
 */
export function ScrollableTable({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className="overflow-x-auto rounded-2xl border border-white/10"
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function BrandMark() {
  return (
    <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-emerald-300/25 bg-emerald-300/10 text-sm font-bold tracking-tight text-emerald-200 shadow-[0_0_30px_rgba(52,211,153,0.08)]">
      ZF
    </div>
  );
}

export type NavSection = "overview" | "payments" | "transactions" | "customers" | "admin";

type SidebarProps = {
  t: Dictionary;
  active: NavSection;
};

/**
 * The primary destinations, defined once.
 *
 * The desktop rail and the mobile drawer both render from this list, because
 * two hand-maintained copies of a navigation drift — and a mobile menu missing
 * the section a reviewer was told to open is worse than no mobile menu at all.
 */
export function primaryDestinations(t: Dictionary): {
  href: string;
  glyph: string;
  label: string;
  section: NavSection;
}[] {
  return [
    { href: "/", glyph: "⌂", label: t.nav.overview, section: "overview" },
    { href: "/payments", glyph: "↗", label: t.nav.payments, section: "payments" },
    { href: "/transactions", glyph: "⇄", label: t.nav.transactions, section: "transactions" },
    { href: "/customers", glyph: "◎", label: t.nav.customers, section: "customers" },
    { href: "/admin", glyph: "◇", label: t.nav.admin, section: "admin" },
  ];
}

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

      {/* Every primary destination is real now. The last PLANNED badges came
          off when the ledger pages shipped — a sidebar advertising three
          unbuilt sections read as unfinished work, and it was. */}
      <nav className="mt-7 space-y-1" aria-label={t.nav.primaryLabel}>
        {primaryDestinations(t).map((destination) => (
          <NavLink
            key={destination.href}
            href={destination.href}
            glyph={destination.glyph}
            label={destination.label}
            current={active === destination.section}
          />
        ))}
      </nav>

      <div className="my-5 h-px bg-white/[0.06]" />

      {/* The audit log deliberately has no sidebar entry: it is a view of the
          console (a tab), not a section of the platform, and showing the same
          label in two navigations at once reads as redundancy — a live charter
          finding. */}
      <nav className="space-y-1" aria-label={t.nav.projectLabel}>
        {/* The health panel is fully rendered on the overview; this is a jump,
            not a page pretending to exist. */}
        <NavLink href="/#system-health" glyph="◉" label={t.nav.systemHealth} current={false} />
        {/* Reviewer notes live in the repository, where an engineer will read
            them; the sidebar link goes there honestly instead of stubbing an
            in-app page. */}
        <a
          href="https://github.com/marcelgilbertdev-oss/zerofayyz-fintech/blob/main/docs/portfolio/TRY_IT_IN_THREE_MINUTES.md"
          target="_blank"
          rel="noreferrer"
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white"
        >
          <span className="grid size-5 place-items-center text-sm text-emerald-200/70">↗</span>
          {t.nav.portfolioNotes}
        </a>
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
