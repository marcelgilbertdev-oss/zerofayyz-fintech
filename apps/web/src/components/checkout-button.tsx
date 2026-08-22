"use client";

import { useId, useState, useSyncExternalStore } from "react";

// Deliberately a copy of packages/api-contract, not an import of it.
//
// Vercel builds this app from its own root directory and never uploads
// `packages/`, so a relative import across that boundary compiles locally and
// fails in CI — that exact mistake is failure #4 in the acceptance-test log.
// The Vue and Svelte clients are deployed prebuilt, so they can and do import
// the shared module.
//
// The duplication is guarded: e2e/contract-parity.spec.ts loads both
// implementations and fails if they ever disagree. Playwright never runs inside
// a Vercel build, so the test may reach across the boundary the bundler cannot.
const MIN_AMOUNT_MINOR = 50;
const MAX_AMOUNT_MINOR = 1_000_000;
const DEFAULT_AMOUNT = "42.00";
// Survives the round trip to Stripe and back. The field must stay pre-filled
// (a demo needs a zero-typing path), but a reviewer who chose $400 and returns
// to see $42 reads it as the system forgetting them — a live charter finding.
const AMOUNT_STORAGE_KEY = "zf_last_amount";

function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);

  return () => window.removeEventListener("storage", onChange);
}

/** Dollars as typed → integer minor units, or null when it is not a valid amount. */
export function toMinorUnits(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, "").replace(/,/g, "");

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }

  // Parsed as text rather than by multiplying a float by 100: `17.35 * 100` is
  // 1734.9999999999998 in IEEE-754, and a payment ledger is the last place to
  // round someone's money by accident.
  const [dollars, cents = ""] = trimmed.split(".");
  const minor = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));

  if (minor < MIN_AMOUNT_MINOR || minor > MAX_AMOUNT_MINOR) {
    return null;
  }

  return minor;
}

type CheckoutButtonProps = {
  label: string;
  loadingLabel: string;
  fallbackError: string;
  amountLabel: string;
  amountHint: string;
  amountInvalid: string;
};

export function CheckoutButton({
  label,
  loadingLabel,
  fallbackError,
  amountLabel,
  amountHint,
  amountInvalid,
}: CheckoutButtonProps) {
  // The remembered amount comes through useSyncExternalStore rather than an
  // effect that calls setState: the server snapshot is null (so SSR renders
  // the default), React swaps to the client snapshot after hydration, and no
  // render-cascading setState ever runs. `typed` then overrides the stored
  // value the moment the user edits.
  const stored = useSyncExternalStore(
    subscribeToStorage,
    () => window.sessionStorage.getItem(AMOUNT_STORAGE_KEY),
    () => null,
  );
  const [typed, setTyped] = useState<string | null>(null);
  const amount =
    typed ?? (stored !== null && toMinorUnits(stored) !== null ? stored : DEFAULT_AMOUNT);
  const setAmount = setTyped;
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountId = useId();
  const hintId = useId();

  const amountMinor = toMinorUnits(amount);
  const amountValid = amountMinor !== null;
  // The permitted range has to be visible to the person typing, not only
  // announced to a screen reader. Shown on focus rather than always, because
  // the header has no room for permanent microcopy — but shown unconditionally
  // once the value is wrong, since that is the moment it is needed most.
  // The error message occupies the same strip beneath the field, so the hint
  // yields to it rather than the two overlapping.
  const hintVisible = (focused || !amountValid) && error === null;

  async function startCheckout() {
    if (amountMinor === null) {
      setError(amountInvalid);
      return;
    }

    setLoading(true);
    setError(null);
    window.sessionStorage.setItem(AMOUNT_STORAGE_KEY, amount.trim());

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountMinor }),
      });
      const payload = (await response.json()) as {
        url?: unknown;
        error?: unknown;
      };

      if (!response.ok || typeof payload.url !== "string") {
        throw new Error(
          typeof payload.error === "string" ? payload.error : fallbackError,
        );
      }

      window.location.assign(payload.url);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : fallbackError);
      setLoading(false);
    }
  }

  return (
    <div className="relative flex items-center gap-2">
      <label htmlFor={amountId} className="sr-only">
        {amountLabel}
      </label>
      <div className="flex items-center rounded-xl border border-white/10 bg-[#16241f] pl-2.5 focus-within:border-emerald-300/40">
        <span aria-hidden="true" className="text-xs font-semibold text-white/40">
          $
        </span>
        <input
          id={amountId}
          name="amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setError(null);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !loading) {
              void startCheckout();
            }
          }}
          aria-describedby={hintId}
          aria-invalid={!amountValid}
          className={`w-20 bg-transparent px-1.5 py-2.5 text-xs font-semibold outline-none placeholder:text-white/30 ${
            amountValid ? "text-white" : "text-rose-200"
          }`}
        />
      </div>
      <p
        id={hintId}
        className={`pointer-events-none absolute left-0 top-full mt-2 whitespace-nowrap text-[10px] leading-4 transition ${
          hintVisible ? "opacity-100" : "opacity-0"
        } ${amountValid ? "text-white/45" : "text-rose-200"}`}
      >
        {amountHint}
      </p>
      <button
        type="button"
        onClick={startCheckout}
        disabled={loading}
        className="rounded-xl bg-emerald-300 px-4 py-2.5 text-xs font-semibold text-[#062018] shadow-[0_10px_30px_rgba(52,211,153,0.12)] transition hover:bg-emerald-200 disabled:cursor-wait disabled:opacity-60"
      >
        {loading ? loadingLabel : label}
      </button>
      <p
        aria-live="polite"
        className="absolute right-0 top-full mt-2 w-64 max-w-[min(16rem,70vw)] text-right text-[10px] leading-4 text-rose-200"
      >
        {error}
      </p>
    </div>
  );
}
