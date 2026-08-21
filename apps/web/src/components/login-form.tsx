"use client";

import { useId, useState } from "react";

type LoginFormProps = {
  emailLabel: string;
  passwordLabel: string;
  submitLabel: string;
  submittingLabel: string;
  fallbackError: string;
  demo: {
    title: string;
    intro: string;
    note: string;
    fill: string;
    filled: string;
    email: string;
    password: string;
  };
};

export function LoginForm({
  emailLabel,
  passwordLabel,
  submitLabel,
  submittingLabel,
  fallbackError,
  demo,
}: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);
  const emailId = useId();
  const passwordId = useId();

  // Clearing the error the moment the user edits a field.
  //
  // Without this the message from the last attempt sits there while you fix
  // the typo it complained about, so a correction that worked still looks
  // rejected. Found in a live charter run: the email had already been fixed
  // and the stale "Incorrect email or password" made it look like it hadn't.
  function edit(setter: (value: string) => void) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      setter(event.target.value);
      setError(null);
    };
  }

  function fillDemoCredentials() {
    setEmail(demo.email);
    setPassword(demo.password);
    setError(null);
    setFilled(true);
  }

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
    <>
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
            onChange={edit(setEmail)}
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
            onChange={edit(setPassword)}
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
        <p
          aria-live="polite"
          className="min-h-4 text-xs text-rose-200"
        >
          {error}
        </p>
      </form>

      <section className="mt-8 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-200">
          {demo.title}
        </h2>
        <p className="mt-2 text-xs leading-5 text-white/70">{demo.intro}</p>
        <dl className="mt-3 space-y-1 font-mono text-xs text-emerald-100">
          <div className="flex gap-2">
            <dt className="text-white/50">email</dt>
            <dd>{demo.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-white/50">password</dt>
            <dd>{demo.password}</dd>
          </div>
        </dl>
        {/* One click instead of two copy-pastes. A reviewer who selects the
            whole block and drops it into the email field sees "Incorrect email
            or password" and concludes the demo is broken — they will not debug
            it, they will close the tab. Observed in a live charter run. */}
        <button
          type="button"
          onClick={fillDemoCredentials}
          className="mt-4 w-full rounded-xl border border-emerald-300/30 px-3.5 py-2 text-xs font-semibold text-emerald-200 transition hover:border-emerald-300/60 hover:text-emerald-100"
        >
          {demo.fill}
        </button>
        <p aria-live="polite" className="mt-2 min-h-4 text-center text-[11px] text-emerald-200/80">
          {filled ? demo.filled : ""}
        </p>
        <p className="mt-3 text-xs leading-5 text-white/50">{demo.note}</p>
      </section>
    </>
  );
}
