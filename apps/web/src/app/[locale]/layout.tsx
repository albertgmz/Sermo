import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Suspense } from "react";
import { UploadLimitProvider } from "@/components/forum/upload-limit";
import { CookieBanner } from "@/components/layout/cookie-banner";
import { EmbedLoader } from "@/components/layout/embed-loader";
import { widthScript } from "@/components/layout/narrow-width";
import { QueryProvider } from "@/components/layout/query-provider";
import { SiteIcon } from "@/components/layout/site-icon";
import { themeScript } from "@/components/layout/theme";
import { WorkerRegistration } from "@/components/layout/worker-registration";
import { pickClientMessages, ROOT_NAMESPACES } from "@/i18n/client-messages";
import { isLocale, LOCALES } from "@/i18n/locales";
import { getSite } from "@/lib/sermo/site";
import "../globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  return {
    title: { default: site.name, template: `%s - ${site.name}` },
    description: site.description || undefined,
  };
}

export const viewport: Viewport = {
  colorScheme: "light dark",
  viewportFit: "cover",
};

// One prerendered shell per language. The segment is hidden: the proxy picks the language of each
// visitor and rewrites to it, and an address that carries it is redirected to the one without.
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [{ maxUploadBytes }, messages] = await Promise.all([
    getSite(),
    getMessages(),
  ]);
  return (
    <html
      lang={locale}
      className={`dark ${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script, no visitor input */}
        <script dangerouslySetInnerHTML={{ __html: widthScript }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script, no visitor input */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Suspense>
          <SiteIcon />
        </Suspense>
        <Suspense>
          <CookieBanner locale={locale} />
        </Suspense>
        <EmbedLoader />
        <WorkerRegistration />
        {/* Only what client components read goes to the browser: the error screen here, the rest
            from the layouts that need it (see client-messages.ts). */}
        <NextIntlClientProvider
          messages={pickClientMessages(
            messages as Parameters<typeof pickClientMessages>[0],
            ROOT_NAMESPACES,
          )}
        >
          <UploadLimitProvider bytes={maxUploadBytes}>
            <QueryProvider>{children}</QueryProvider>
          </UploadLimitProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
