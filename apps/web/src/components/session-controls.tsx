"use client";

import { useState } from "react";

export function SignOutButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);

    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Land on the public dashboard either way — the API clears the cookie
      // even for a session it no longer recognises.
      window.location.assign("/");
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="rounded-xl border border-white/15 px-3.5 py-2 text-xs font-semibold text-white/80 transition hover:border-white/30 hover:text-white disabled:cursor-wait disabled:opacity-60"
    >
      {label}
    </button>
  );
}

export function RevokeSessionButton({
  sessionId,
  isCurrent,
  label,
  busyLabel,
}: {
  sessionId: string;
  isCurrent: boolean;
  label: string;
  busyLabel: string;
}) {
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);

    try {
      await fetch(`/api/admin/sessions/${sessionId}`, { method: "DELETE" });
    } finally {
      // Revoking your own session signs you out; landing on the dashboard is
      // honest about that. Revoking someone else's just needs fresh data.
      window.location.assign(isCurrent ? "/" : "/admin");
    }
  }

  return (
    <button
      type="button"
      onClick={revoke}
      disabled={busy}
      className="rounded-lg border border-rose-300/25 px-3 py-1.5 text-[11px] font-semibold text-rose-200 transition hover:border-rose-300/50 disabled:cursor-wait disabled:opacity-60"
    >
      {busy ? busyLabel : label}
    </button>
  );
}
