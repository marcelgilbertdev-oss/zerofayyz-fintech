"use client";

import { useId, useState } from "react";

// Mirrors the bounds the API enforces in its route schema. Checking here as
// well is not duplication for its own sake: it turns a 400 round-trip into
// immediate feedback. The server remains the authority — this field can be
// edited away in devtools, the route schema cannot.
const MIN_AMOUNT_MINOR = 50;
const MAX_AMOUNT_MINOR = 1_000_000;
const DEFAULT_AMOUNT = "42.00";

type CheckoutButtonProps = {
  label: string;
  loadingLabel: string;
  fallbackError: string;
  amountLabel: string;
  amountHint: string;
  amountInvalid: string;
};

/** Dollars as typed → integer minor units, or null if it is not a valid amount. */
export function toMinorUnits(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, "").replace(/,/g, "");

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }

  // Parse the decimal as text rather than multiplying a float by 100: at these
  // magnitudes `17.35 * 100` is 1734.9999999999998, and a payment ledger is the
  // last place to round a customer's money by accident.
  const [dollars, cents = ""] = trimmed.split(".");
  const minor = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));

  if (minor < MIN_AMOUNT_MINOR || minor > MAX_AMOUNT_MINOR) {
    return null;
  }

  return minor;
}

export function CheckoutButton({
  label,
  loadingLabel,
  fallbackError,
  amountLabel,
  amountHint,
  amountInvalid,
}: CheckoutButtonProps) {
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountId = useId();
  const hintId = useId();

  const amountMinor = toMinorUnits(amount);
  const amountValid = amountMinor !== null;

  async function startCheckout() {
    if (amountMinor === null) {
      setError(amountInvalid);
      return;
    }

    setLoading(true);
    setError(null);

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
          onKeyDown={(event) => {
            if (event.key === "Enter" && !loading) {
              void startCheckout();
            }
          }}
          aria-describedby={hintId}
          aria-invalid={!amountValid}
          className="w-20 bg-transparent px-1.5 py-2.5 text-xs font-semibold text-white outline-none placeholder:text-white/30"
        />
      </div>
      <p id={hintId} className="sr-only">
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
        className="absolute right-0 top-full mt-2 w-64 text-right text-[10px] leading-4 text-rose-200"
      >
        {error}
      </p>
    </div>
  );
}
