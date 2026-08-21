import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { RevokeSessionButton, SignOutButton } from "@/components/session-controls";
import { getDictionary } from "@/i18n/dictionaries";
import { DEFAULT_LOCALE, formatShortDate, isLocale, type Locale } from "@/i18n/locale";
import {
  getSessionUser,
  incomingCookieHeader,
  proxyToApi,
} from "@/lib/api-session";
import { LOCALE_HEADER } from "@/proxy";

/**
 * The privileged half of the dashboard, rendered on the server from the
 * caller's session. Panels the caller's role cannot read are not fetched and
 * not rendered — but that is presentation. The API re-checks the role on every
 * request, and the integration suite proves those refusals independently.
 */

type SessionEntry = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  actorEmail: string | null;
  createdAt: string;
};

type UserEntry = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  lastLoginAt: string | null;
  paymentCount: number;
};

async function fetchPanel<T>(path: string, cookie: string | null): Promise<T | null> {
  try {
    const response = await proxyToApi(path, { method: "GET", cookie });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function formatTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(locale === "ja" ? "ja-JP" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `${formatShortDate(date, locale)} ${time}`;
}

const ROLE_STYLES: Record<string, string> = {
  admin: "border-emerald-300/30 bg-emerald-300/10 text-emerald-200",
  operator: "border-sky-300/30 bg-sky-300/10 text-sky-200",
  viewer: "border-white/15 bg-white/5 text-white/70",
  customer: "border-white/10 bg-white/[0.03] text-white/50",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ROLE_STYLES[role] ?? ROLE_STYLES.customer}`}
    >
      {role}
    </span>
  );
}

export default async function AdminPage() {
  const requested = (await headers()).get(LOCALE_HEADER);
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;
  const t = getDictionary(locale);

  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  const cookie = await incomingCookieHeader();
  const isAdmin = user.role === "admin";
  const canReadAudit = user.role === "admin" || user.role === "operator";

  const [sessions, audit, users] = await Promise.all([
    isAdmin
      ? fetchPanel<{ data: SessionEntry[] }>("/api/v1/admin/sessions", cookie)
      : Promise.resolve(null),
    canReadAudit
      ? fetchPanel<{ data: AuditEntry[] }>("/api/v1/admin/audit-logs?limit=50", cookie)
      : Promise.resolve(null),
    isAdmin
      ? fetchPanel<{ data: UserEntry[] }>("/api/v1/admin/users", cookie)
      : Promise.resolve(null),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/"
            className="text-xs font-semibold text-emerald-200/80 hover:text-emerald-100"
          >
            ← ZEROFAYYZ FINTECH
          </Link>
          <h1 className="mt-3 text-2xl font-semibold text-white">{t.admin.title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">{t.admin.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs font-semibold text-white/80">
              {t.auth.signedInAs(user.displayName)}
            </p>
            <div className="mt-1 flex justify-end">
              <RoleBadge role={user.role} />
            </div>
          </div>
          <SignOutButton label={t.auth.signOut} />
        </div>
      </div>

      {!isAdmin && (
        <p className="mb-8 rounded-2xl border border-sky-300/20 bg-sky-300/[0.06] px-5 py-4 text-xs leading-5 text-sky-100">
          {t.admin.operatorNotice}
        </p>
      )}

      {isAdmin && (
        <section aria-labelledby="presence-title" className="mb-10">
          <h2 id="presence-title" className="text-sm font-bold text-white">
            {t.admin.presenceTitle}
          </h2>
          <p className="mt-1 mb-4 text-xs text-white/50">{t.admin.presenceSubtitle}</p>
          {sessions === null ? (
            <p className="text-xs text-rose-200">{t.admin.loadError}</p>
          ) : sessions.data.length === 0 ? (
            <p className="text-xs text-white/50">{t.admin.presenceEmpty}</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wider text-white/50">
                  <tr>
                    <th className="px-4 py-3">{t.admin.presenceColumns.who}</th>
                    <th className="px-4 py-3">{t.admin.presenceColumns.role}</th>
                    <th className="px-4 py-3">{t.admin.presenceColumns.signedIn}</th>
                    <th className="px-4 py-3">{t.admin.presenceColumns.lastSeen}</th>
                    <th className="px-4 py-3">{t.admin.presenceColumns.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {sessions.data.map((session) => (
                    <tr key={session.id}>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-white/90">{session.displayName}</span>
                        <span className="ml-2 text-white/50">{session.email}</span>
                        {session.current && (
                          <span className="ml-2 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
                            {t.admin.presenceYou}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <RoleBadge role={session.role} />
                      </td>
                      <td className="px-4 py-3 text-white/60">{formatTime(session.createdAt, locale)}</td>
                      <td className="px-4 py-3 text-white/60">{formatTime(session.lastSeenAt, locale)}</td>
                      <td className="px-4 py-3">
                        <RevokeSessionButton
                          sessionId={session.id}
                          isCurrent={session.current}
                          label={t.admin.presenceRevoke}
                          busyLabel={t.admin.presenceRevoking}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {canReadAudit && (
        <section aria-labelledby="audit-title" className="mb-10">
          <h2 id="audit-title" className="text-sm font-bold text-white">
            {t.admin.auditTitle}
          </h2>
          <p className="mt-1 mb-4 text-xs text-white/50">{t.admin.auditSubtitle}</p>
          {audit === null ? (
            <p className="text-xs text-rose-200">{t.admin.loadError}</p>
          ) : audit.data.length === 0 ? (
            <p className="text-xs text-white/50">{t.admin.auditEmpty}</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wider text-white/50">
                  <tr>
                    <th className="px-4 py-3">{t.admin.auditColumns.when}</th>
                    <th className="px-4 py-3">{t.admin.auditColumns.action}</th>
                    <th className="px-4 py-3">{t.admin.auditColumns.actor}</th>
                    <th className="px-4 py-3">{t.admin.auditColumns.entity}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {audit.data.map((entry) => (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-white/60">
                        {formatTime(entry.createdAt, locale)}
                      </td>
                      <td className="px-4 py-3 font-mono text-emerald-100/90">{entry.action}</td>
                      <td className="px-4 py-3 text-white/70">
                        {entry.actorEmail ?? t.admin.auditSystem}
                      </td>
                      <td className="px-4 py-3 text-white/50">{entry.entityType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {isAdmin && (
        <section aria-labelledby="users-title">
          <h2 id="users-title" className="text-sm font-bold text-white">
            {t.admin.usersTitle}
          </h2>
          <p className="mt-1 mb-4 text-xs text-white/50">{t.admin.usersSubtitle}</p>
          {users === null ? (
            <p className="text-xs text-rose-200">{t.admin.loadError}</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full text-left text-xs">
                <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wider text-white/50">
                  <tr>
                    <th className="px-4 py-3">{t.admin.usersColumns.who}</th>
                    <th className="px-4 py-3">{t.admin.usersColumns.role}</th>
                    <th className="px-4 py-3">{t.admin.usersColumns.payments}</th>
                    <th className="px-4 py-3">{t.admin.usersColumns.lastLogin}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {users.data.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-white/90">{entry.displayName}</span>
                        <span className="ml-2 text-white/50">{entry.email}</span>
                      </td>
                      <td className="px-4 py-3">
                        <RoleBadge role={entry.role} />
                      </td>
                      <td className="px-4 py-3 text-white/70">{entry.paymentCount}</td>
                      <td className="px-4 py-3 text-white/60">
                        {entry.lastLoginAt
                          ? formatTime(entry.lastLoginAt, locale)
                          : t.admin.usersNever}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
