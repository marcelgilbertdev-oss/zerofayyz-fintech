import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getDictionary } from "@/i18n/dictionaries";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locale";
import { getSessionUser } from "@/lib/api-session";
import { LOCALE_HEADER } from "@/proxy";

export default async function LoginPage() {
  const requested = (await headers()).get(LOCALE_HEADER);
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;
  const t = getDictionary(locale);

  // Already signed in? The login page has nothing further to offer.
  if (await getSessionUser()) {
    redirect("/admin");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-8 text-xs font-semibold text-emerald-200/80 hover:text-emerald-100">
        ← ZEROFAYYZ FINTECH
      </Link>
      <h1 className="text-2xl font-semibold text-white">{t.auth.loginTitle}</h1>
      <p className="mt-2 mb-8 text-sm leading-6 text-white/60">{t.auth.loginSubtitle}</p>

      <LoginForm
        emailLabel={t.auth.emailLabel}
        passwordLabel={t.auth.passwordLabel}
        submitLabel={t.auth.signIn}
        submittingLabel={t.auth.submitting}
        fallbackError={t.auth.genericError}
      />

      <section className="mt-8 rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.06] p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-200">
          {t.auth.demoTitle}
        </h2>
        <p className="mt-2 text-xs leading-5 text-white/70">{t.auth.demoIntro}</p>
        <dl className="mt-3 space-y-1 font-mono text-xs text-emerald-100">
          <div className="flex gap-2">
            <dt className="text-white/50">email</dt>
            <dd>demo@zerofayyz.test</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-white/50">password</dt>
            <dd>view-the-ledger</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-5 text-white/50">{t.auth.demoNote}</p>
      </section>
    </main>
  );
}
