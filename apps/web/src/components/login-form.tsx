"use client";

import { useId, useState } from "react";

type LoginFormProps = {
  emailLabel: string;
  passwordLabel: string;
  submitLabel: string;
  submittingLabel: string;
  fallbackError: string;
};

export function LoginForm({
  emailLabel,
  passwordLabel,
  submitLabel,
  submittingLabel,
  fallbackError,
}: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailId = useId();
  const passwordId = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as { error?: unknown };

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : fallbackError,
        );
      }

      // A full navigation, not a client-side route change: the admin page is
      // server-rendered from the cookie that was just set, and the fresh
      // document request is what carries it there.
      window.location.assign("/admin");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : fallbackError);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label
          htmlFor={emailId}
          className="mb-1.5 block text-xs font-semibold text-white/70"
        >
          {emailLabel}
        </label>
        <input
          id={emailId}
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-xl border border-white/10 bg-[#16241f] px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-300/40"
        />
      </div>
      <div>
        <label
          htmlFor={passwordId}
          className="mb-1.5 block text-xs font-semibold text-white/70"
        >
          {passwordLabel}
        </label>
        <input
          id={passwordId}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-xl border border-white/10 bg-[#16241f] px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-300/40"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-emerald-300 px-4 py-2.5 text-sm font-semibold text-[#062018] transition hover:bg-emerald-200 disabled:cursor-wait disabled:opacity-60"
      >
        {submitting ? submittingLabel : submitLabel}
      </button>
      <p aria-live="polite" role={error ? "alert" : undefined} className="min-h-4 text-xs text-rose-200">
        {error}
      </p>
    </form>
  );
}
