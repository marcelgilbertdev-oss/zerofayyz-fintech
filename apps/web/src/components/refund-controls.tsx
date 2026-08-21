"use client";

import { useState } from "react";

import { toMinorUnits } from "./checkout-button";

async function post(path: string, body: unknown): Promise<string | null> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
  return typeof payload.error === "string" ? payload.error : "Request failed";
}

export function RequestRefundButton({
  paymentId,
  labels,
}: {
  paymentId: string;
  labels: {
    open: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    amountLabel: string;
    submit: string;
    submitting: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    // Empty means the full amount; anything typed must parse as money.
    const amountMinor = amount.trim() === "" ? undefined : toMinorUnits(amount);

    if (amountMinor === null) {
      setError("Enter a valid amount, or leave it empty for the full amount");
      return;
    }

    setBusy(true);
    setError(null);

    const failed = await post(`/api/admin/payments/${paymentId}/refund-requests`, {
      reason,
      ...(amountMinor === undefined ? {} : { amountMinor }),
    });

    if (failed) {
      setError(failed);
      setBusy(false);
      return;
    }

    window.location.assign("/admin");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-amber-300/25 px-3 py-1.5 text-[11px] font-semibold text-amber-200 transition hover:border-amber-300/50"
      >
        {labels.open}
      </button>
    );
  }

  return (
    <div className="flex min-w-64 flex-col gap-2">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
        {labels.reasonLabel}
        <input
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setError(null);
          }}
          placeholder={labels.reasonPlaceholder}
          className="mt-1 w-full rounded-lg border border-white/10 bg-[#16241f] px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-white outline-none focus:border-amber-300/40"
        />
      </label>
      <label className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
        {labels.amountLabel}
        <input
          value={amount}
          inputMode="decimal"
          onChange={(event) => {
            setAmount(event.target.value);
            setError(null);
          }}
          className="mt-1 w-full rounded-lg border border-white/10 bg-[#16241f] px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-white outline-none focus:border-amber-300/40"
        />
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={busy || reason.trim().length < 5}
        className="rounded-lg bg-amber-300 px-3 py-1.5 text-[11px] font-semibold text-[#201505] transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? labels.submitting : labels.submit}
      </button>
      <p aria-live="polite" className="min-h-3 text-[10px] text-rose-200">
        {error}
      </p>
    </div>
  );
}

export function DecideRefundButtons({
  requestId,
  labels,
}: {
  requestId: string;
  labels: {
    approve: string;
    approving: string;
    reject: string;
    rejecting: string;
    rejectNotePlaceholder: string;
  };
}) {
  const [mode, setMode] = useState<"idle" | "approving" | "rejecting">("idle");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    setError(null);

    const failed = await post(
      `/api/admin/refund-requests/${requestId}/${action}`,
      action === "reject" ? { note } : {},
    );

    if (failed) {
      setError(failed);
      setBusy(false);
      return;
    }

    window.location.assign("/admin");
  }

  if (mode === "rejecting") {
    return (
      <div className="flex min-w-56 flex-col gap-2">
        <input
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setError(null);
          }}
          placeholder={labels.rejectNotePlaceholder}
          className="rounded-lg border border-white/10 bg-[#16241f] px-2.5 py-1.5 text-xs text-white outline-none focus:border-rose-300/40"
        />
        <button
          type="button"
          onClick={() => decide("reject")}
          disabled={busy || note.trim().length < 3}
          className="rounded-lg border border-rose-300/30 px-3 py-1.5 text-[11px] font-semibold text-rose-200 transition hover:border-rose-300/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? labels.rejecting : labels.reject}
        </button>
        <p aria-live="polite" className="min-h-3 text-[10px] text-rose-200">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => decide("approve")}
          disabled={busy}
          className="rounded-lg bg-emerald-300 px-3 py-1.5 text-[11px] font-semibold text-[#062018] transition hover:bg-emerald-200 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? labels.approving : labels.approve}
        </button>
        <button
          type="button"
          onClick={() => setMode("rejecting")}
          disabled={busy}
          className="rounded-lg border border-rose-300/30 px-3 py-1.5 text-[11px] font-semibold text-rose-200 transition hover:border-rose-300/60"
        >
          {labels.reject}
        </button>
      </div>
      <p aria-live="polite" className="min-h-3 max-w-52 text-[10px] leading-3 text-rose-200">
        {error}
      </p>
    </div>
  );
}

export function WithdrawRefundButton({
  requestId,
  labels,
}: {
  requestId: string;
  labels: { withdraw: string; withdrawing: string };
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    setError(null);

    const failed = await post(`/api/admin/refund-requests/${requestId}/withdraw`, {});

    if (failed) {
      setError(failed);
      setBusy(false);
      return;
    }

    window.location.assign("/admin");
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={withdraw}
        disabled={busy}
        className="rounded-lg border border-white/20 px-3 py-1.5 text-[11px] font-semibold text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? labels.withdrawing : labels.withdraw}
      </button>
      <p aria-live="polite" className="min-h-3 text-[10px] text-rose-200">
        {error}
      </p>
    </div>
  );
}
