import type { Metadata } from "next";
import { headers } from "next/headers";

import { isLocale, DEFAULT_LOCALE } from "@/i18n/locale";
import { LOCALE_HEADER } from "@/proxy";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ZEROFAYYZ FINTECH | Cloud Payments & Operations",
  description:
    "A sandbox fintech portfolio platform demonstrating payment operations, transaction monitoring, and cloud-ready engineering.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Screen readers announce content using this attribute, and browsers pick
  // line-breaking and font behaviour from it. A Japanese page labelled lang="en"
  // is an accessibility defect, not a cosmetic one.
  const requested = (await headers()).get(LOCALE_HEADER);
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#07110f] text-[#edf5f1]">{children}</body>
    </html>
  );
}
