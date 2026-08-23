"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Turns "the API did not answer in time" from a dead end into a wait.
 *
 * The dashboard is server-rendered. If the API was still starting when the
 * render happened, the page is finished and static — it has no way to notice the
 * API coming up a few seconds later, so a reviewer would be looking at a
 * permanently wrong page until they thought to reload. Most people do not
 * reload; they leave.
 *
 * So the browser polls a cheap reachability endpoint and, the moment it answers,
 * asks Next.js to re-render the route. The tiles fill in by themselves.
 */

/**
 * Backoff, in milliseconds between attempts.
 *
 * Front-loaded because the common case is a service most of the way through
 * starting, then spaced out so that a genuinely dead API is not hammered by
 * every open tab. The array's length is the attempt limit: giving up visibly is
 * better than a spinner that never resolves.
 */
const RETRY_SCHEDULE_MS = [
  1_000, 2_000, 3_000, 4_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000,
  8_000, 8_000, 8_000, 10_000, 10_000,
] as const;

export type WakeWatcherCopy = {
  title: string;
  body: string;
  retrying: string;
  gaveUp: string;
  reload: string;
};

export function WakeWatcher({ copy }: { copy: WakeWatcherCopy }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  // Derived, not stored. Writing this into state from inside the effect would
  // schedule a second render to say something the first render already knew.
  const exhausted = attempt >= RETRY_SCHEDULE_MS.length;

  useEffect(() => {
    if (exhausted) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/health", { cache: "no-store" });
          const payload = (await response.json()) as { reachable?: unknown };

          if (cancelled) return;

          if (payload.reachable === true) {
            // Re-runs the server component with a live API behind it. The
            // reviewer sees the real numbers arrive without touching anything.
            router.refresh();
            return;
          }
        } catch {
          // A failed poll is just another "not yet" — fall through and retry.
        }

        if (!cancelled) setAttempt((current) => current + 1);
      })();
    }, RETRY_SCHEDULE_MS[attempt]);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [attempt, exhausted, router]);

  return (
    <div
      // Polite rather than assertive: this is a progress note, and it must not
      // interrupt a screen-reader user mid-sentence when it updates.
      role="status"
      aria-live="polite"
      className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-300 motion-safe:animate-pulse"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-100">{copy.title}</p>
          <p className="mt-1 text-sm text-amber-100/70">
            {exhausted ? copy.gaveUp : copy.body}
          </p>
        </div>
      </div>

      {exhausted ? (
        <button
          type="button"
          onClick={() => {
            setAttempt(0);
            router.refresh();
          }}
          className="shrink-0 rounded-lg border border-amber-300/30 px-3 py-1.5 text-sm font-medium text-amber-100 transition hover:bg-amber-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        >
          {copy.reload}
        </button>
      ) : (
        <span className="shrink-0 text-xs text-amber-100/50">{copy.retrying}</span>
      )}
    </div>
  );
}
