"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { PasswordInput } from "./password-input";

async function send(path: string, method: string, body?: unknown): Promise<string | null> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
  return typeof payload.error === "string" ? payload.error : "Request failed";
}

export function CreateAccountForm({
  labels,
}: {
  labels: {
    title: string;
    email: string;
    name: string;
    role: string;
    password: string;
    submit: string;
    submitting: string;
    showPassword: string;
    hidePassword: string;
  };
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("viewer");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Explicit for/id association rather than label-wrapping. A <select> wrapped
  // in its label inherits the option text into its accessible name ("Role
  // viewer operator admin"), which breaks exact-name queries for assistive
  // tech and tests alike.
  const router = useRouter();
  const emailId = useId();
  const nameId = useId();
  const roleId = useId();
  const passwordId = useId();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const failed = await send("/api/admin/users", "POST", {
      email,
      displayName,
      role,
      password,
    });

    if (failed) {
      setError(failed);
      setBusy(false);
      return;
    }

    // Clear the form and soft-refresh: the new row appears in the table below
    // without the page jumping to the top — the scroll reset after account
    // creation was a finding from the live charter run.
    setEmail("");
    setDisplayName("");
    setRole("viewer");
    setPassword("");
    setBusy(false);
    router.refresh();
  }

  const field =
    "rounded-lg border border-white/10 bg-[#16241f] px-2.5 py-2 text-xs text-white outline-none focus:border-emerald-300/40";

  return (
    <form
      onSubmit={submit}
      className="mb-4 grid gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:grid-cols-2 lg:grid-cols-5"
    >
      <p className="text-xs font-bold text-white sm:col-span-2 lg:col-span-5">{labels.title}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={emailId} className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
          {labels.email}
        </label>
        <input
          id={emailId}
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={field}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
          {labels.name}
        </label>
        <input
          id={nameId}
          required
          minLength={2}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className={field}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={roleId} className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
          {labels.role}
        </label>
        <select
          id={roleId}
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className={field}
        >
          <option value="viewer">viewer</option>
          <option value="operator">operator</option>
          <option value="admin">admin</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={passwordId} className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
          {labels.password}
        </label>
        <PasswordInput
          id={passwordId}
          value={password}
          onChange={setPassword}
          required
          minLength={12}
          autoComplete="new-password"
          showLabel={labels.showPassword}
          hideLabel={labels.hidePassword}
          className={`${field} w-full`}
        />
      </div>
      <div className="flex items-end">
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-emerald-300 px-3 py-2 text-[11px] font-semibold text-[#062018] transition hover:bg-emerald-200 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? labels.submitting : labels.submit}
        </button>
      </div>
      <p aria-live="polite" className="min-h-3 text-[10px] text-rose-200 sm:col-span-2 lg:col-span-5">
        {error}
      </p>
    </form>
  );
}

export function AccountRowControls({
  userId,
  role,
  disabled,
  labels,
}: {
  userId: string;
  role: string;
  disabled: boolean;
  labels: { disable: string; enable: string };
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);

    const failed = await action();

    if (failed) {
      setError(failed);
      setBusy(false);
      return;
    }

    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <select
          aria-label="Role"
          value={role}
          disabled={busy}
          onChange={(event) =>
            run(() =>
              send(`/api/admin/users/${userId}/role`, "PATCH", { role: event.target.value }),
            )
          }
          className="rounded-lg border border-white/10 bg-[#16241f] px-2 py-1.5 text-[11px] text-white outline-none focus:border-emerald-300/40"
        >
          <option value="viewer">viewer</option>
          <option value="operator">operator</option>
          <option value="admin">admin</option>
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(() =>
              send(`/api/admin/users/${userId}/${disabled ? "enable" : "disable"}`, "POST"),
            )
          }
          className={`rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
            disabled
              ? "border-emerald-300/30 text-emerald-200 hover:border-emerald-300/60"
              : "border-rose-300/25 text-rose-200 hover:border-rose-300/50"
          }`}
        >
          {disabled ? labels.enable : labels.disable}
        </button>
      </div>
      <p aria-live="polite" className="min-h-3 max-w-52 text-[10px] leading-3 text-rose-200">
        {error}
      </p>
    </div>
  );
}
