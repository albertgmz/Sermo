import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { Suspense } from "react";
import { UploadLimitProvider } from "@/components/forum/upload-limit";
import { CookieBanner } from "@/components/layout/cookie-banner";
import { DocumentNonceKeeper } from "@/components/layout/document-nonce-keeper";
import { EmbedLoader } from "@/components/layout/embed-loader";
import { widthScript } from "@/components/layout/narrow-width";
import { QueryProvider } from "@/components/layout/query-provider";
import { SiteIcon } from "@/components/layout/site-icon";
import { themeScript } from "@/components/layout/theme";
import { WorkerRegistration } from "@/components/layout/worker-registration";
import { pickClientMessages, ROOT_NAMESPACES } from "@/i18n/client-messages";
import { isLocale, LOCALES } from "@/i18n/locales";
import { OPENSEARCH_URL } from "@/lib/opensearch";
import { THEME_COLORS } from "@/lib/pwa";
import { scriptNonce } from "@/lib/script-nonce";
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

// The bar the browser draws above the page takes the background of the device's theme; the theme
// script sets it to the one shown when the visitor picked another.
export const viewport: Viewport = {
  colorScheme: "light dark",
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

// Every page is rendered for its request: the scripts of a page carry that response's nonce (see
// lib/security-headers.ts), and a shell prerendered at build time would carry none, so the browser
// would refuse them. Next's guide to a Content-Security-Policy says the same of partial
// prerendering; this lets the root layout read the nonce and block on it.
export const instant = false;

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
  const [{ maxUploadBytes, name }, messages, nonce] = await Promise.all([
    getSite(),
    getMessages(),
    scriptNonce(),
  ]);
  return (
    <html
      lang={locale}
      className={`dark ${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          nonce={nonce}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script, no visitor input
          dangerouslySetInnerHTML={{ __html: widthScript }}
        />
        <script
          nonce={nonce}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script, no visitor input
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        <link
          rel="search"
          type="application/opensearchdescription+xml"
          title={name}
          href={OPENSEARCH_URL}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Suspense>
          <SiteIcon />
        </Suspense>
        <Suspense>
          <CookieBanner locale={locale} />
        </Suspense>
        <DocumentNonceKeeper />
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
