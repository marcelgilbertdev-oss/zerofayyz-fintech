"use client";

import { useState } from "react";

export function CheckoutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        url?: unknown;
        error?: unknown;
      };

      if (!response.ok || typeof payload.url !== "string") {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Unable to start checkout",
        );
      }

      window.location.assign(payload.url);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Unable to start checkout",
      );
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={startCheckout}
        disabled={loading}
        className="rounded-xl bg-emerald-300 px-4 py-2.5 text-xs font-semibold text-[#062018] shadow-[0_10px_30px_rgba(52,211,153,0.12)] transition hover:bg-emerald-200 disabled:cursor-wait disabled:opacity-60"
      >
        {loading ? "Opening Stripe…" : "+ Test payment"}
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
