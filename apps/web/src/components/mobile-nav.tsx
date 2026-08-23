"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { NavSection } from "./app-shell";

/**
 * Navigation for everything narrower than the desktop rail.
 *
 * The sidebar is `hidden lg:flex`, which meant that below 1024px the platform
 * had no navigation at all: Payments, Transactions, Customers and the admin
 * console were unreachable on a phone. A reviewer opening the demo link on
 * their phone — which many will — could see the overview and nothing else.
 *
 * A drawer rather than a bottom bar, because these are sections of a console
 * and the sidebar metaphor should survive the breakpoint. The behaviours that
 * make it a real dialog rather than a div that appears: focus moves in on open
 * and returns to the trigger on close, Escape closes, the background is inert
 * to pointer and screen reader alike, and page scroll is locked while it is
 * open so the content behind does not slide under the panel.
 *
 * Props are plain strings and plain data, never the dictionary object. The
 * dictionary carries functions (`signedInAs`, `liveCount`), and functions
 * cannot cross the server-to-client boundary — passing `t` wholesale into a
 * client component fails the render, which is how this signature was arrived
 * at rather than chosen.
 */
export type MobileNavDestination = {
  href: string;
  glyph: string;
  label: string;
  section: NavSection;
};

export function MobileNav({
  destinations,
  active,
  labels,
}: {
  destinations: MobileNavDestination[];
  active: NavSection;
  labels: {
    primaryLabel: string;
    closeMenu: string;
    brandName: string;
    brandSuffix: string;
    portfolioNotes: string;
  };
}) {
  // `open` is the mount guard the portal needs, without a second flag: it
  // starts false, so the server render and the first client render both skip
  // the portal, and the only thing that can set it true is a click — which
  // never happens anywhere but a browser with a document.body.
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    // The first destination, not the panel itself: a keyboard user should land
    // on something actionable rather than on a container they must arrow out of.
    const firstLink = panelRef.current?.querySelector<HTMLAnchorElement>("a[href]");
    firstLink?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        // Focus goes back where it came from, so closing does not dump the
        // caret at the top of the document.
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={labels.primaryLabel}
        className="grid size-9 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-white/75 transition hover:border-emerald-300/30 hover:text-white"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </svg>
      </button>

      {open &&
        createPortal(
          // Rendered into document.body, deliberately, and this is the whole
          // fix rather than a tidiness preference.
          //
          // MobileNav is used inside the page header, and that header carries
          // `bg-[#07110f]/80 backdrop-blur-xl`. An element with a backdrop-filter
          // establishes a stacking context AND a containing block for
          // fixed-position descendants — so a drawer rendered in place was never
          // a top-level overlay. It was composited inside a parent that is itself
          // 80% transparent and blurring whatever sits behind it, which is
          // exactly what a reviewer saw on an iPhone: the page showing through
          // the menu, with the menu text painted on top.
          //
          // An earlier attempt gave the panel and the scrim explicit z-indexes.
          // Those are correct and have been kept, but they could not have fixed
          // this: they ordered two siblings correctly *within* the trapped
          // context. The trap was the ancestor, so the overlay has to leave it.
          //
          // Chromium composites the nested case in a way that happens to look
          // right, which is why every desktop browser and the whole CI pipeline
          // showed a working drawer.
          <div className="fixed inset-0 isolate z-50">
          {/* Inert background: a click anywhere outside dismisses, and
              aria-hidden keeps the page behind out of the reader's path.

              z-0 pairs with the panel's z-10 so the two state their order
              rather than inheriting it from DOM position. Worth keeping — an
              element with backdrop-filter is promoted to its own compositing
              layer, and leaving a promoted sibling's order implied is asking
              for trouble — but see the note on the portal above: this was not
              what made the drawer transparent. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="absolute inset-0 z-0 h-full w-full cursor-default bg-black/60 backdrop-blur-sm"
          />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label={labels.primaryLabel}
            // z-10 states the stacking order the layout always assumed. Without
            // it the panel relies on DOM order, which the compositor is free to
            // disregard once a sibling has been promoted.
            className="absolute inset-y-0 left-0 z-10 flex w-72 max-w-[85vw] flex-col border-r border-white/[0.07] bg-[#081310] px-5 py-6 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold tracking-[0.08em] text-white">{labels.brandName}</p>
                <p className="text-[10px] font-medium tracking-[0.24em] text-emerald-300/70">{labels.brandSuffix}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                aria-label={labels.closeMenu}
                className="grid size-8 place-items-center rounded-lg border border-white/[0.08] text-white/70 transition hover:border-rose-300/30 hover:text-rose-200"
              >
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <nav className="mt-7 space-y-1" aria-label={labels.primaryLabel}>
              {destinations.map((destination) => (
                <a
                  key={destination.href}
                  href={destination.href}
                  aria-current={active === destination.section ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors ${
                    active === destination.section
                      ? "bg-white/[0.08] font-medium text-white shadow-[inset_3px_0_0_#6ee7b7]"
                      : "text-white/70 hover:bg-white/[0.05] hover:text-white"
                  }`}
                >
                  <span className="grid size-5 place-items-center text-sm text-emerald-200/80">
                    {destination.glyph}
                  </span>
                  {destination.label}
                </a>
              ))}
            </nav>

            <div className="my-5 h-px bg-white/[0.06]" />

            <a
              href="https://github.com/marcelgilbertdev-oss/zerofayyz-fintech/blob/main/docs/portfolio/TRY_IT_IN_THREE_MINUTES.md"
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              <span className="grid size-5 place-items-center text-sm text-emerald-200/70">↗</span>
              {labels.portfolioNotes}
            </a>
          </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
