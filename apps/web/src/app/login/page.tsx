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
        contactAdmin={t.auth.contactAdmin}
        showPassword={t.auth.showPassword}
        hidePassword={t.auth.hidePassword}
        demo={{
          title: t.auth.demoTitle,
          intro: t.auth.demoIntro,
          note: t.auth.demoNote,
          fill: t.auth.demoFill,
          filled: t.auth.demoFilled,
          // Published on purpose, and kept in one place so the page and the
          // seed cannot drift — an integration test asserts this exact
          // password is the one stored for the demo account.
          email: "demo@zerofayyz.test",
          password: "view-the-ledger",
        }}
      />

    </main>
  );
}
