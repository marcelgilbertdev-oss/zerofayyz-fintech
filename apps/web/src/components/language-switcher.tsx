import type { Locale } from "@/i18n/locale";

type LanguageSwitcherProps = {
  locale: Locale;
  label: string;
  toJapanese: string;
  toEnglish: string;
};

/**
 * Plain anchors, deliberately not next/link.
 *
 * A client-side navigation does not re-render the root layout — that is what
 * layouts are for — so the page content would switch to Japanese while
 * <html lang> stayed "en". Changing the document's language is a document-level
 * change, so it gets a document-level navigation. It also keeps the switcher
 * working with JavaScript disabled, and makes each locale a shareable URL.
 */
export function LanguageSwitcher({
  locale,
  label,
  toJapanese,
  toEnglish,
}: LanguageSwitcherProps) {
  const options: Array<{ value: Locale; text: string; hreflang: string }> = [
    { value: "en", text: toEnglish, hreflang: "en" },
    { value: "ja", text: toJapanese, hreflang: "ja" },
  ];

  return (
    <nav
      aria-label={label}
      className="hidden items-center gap-0.5 rounded-lg border border-white/[0.08] bg-white/[0.035] p-0.5 sm:flex"
    >
      {options.map((option) => {
        const active = option.value === locale;

        return (
          <a
            key={option.value}
            href={`/?lang=${option.value}`}
            hrefLang={option.hreflang}
            lang={option.hreflang}
            aria-current={active ? "true" : undefined}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              active
                ? "bg-white/[0.10] text-white"
                : "text-white/65 hover:bg-white/[0.05] hover:text-white/80"
            }`}
          >
            {option.text}
          </a>
        );
      })}
    </nav>
  );
}
