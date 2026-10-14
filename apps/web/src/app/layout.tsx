import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { Suspense } from "react";
import "@/components/forum/member-card-parts";
import { UploadLimitProvider } from "@/components/forum/upload-limit";
import { widthScript } from "@/components/layout/narrow-width";
import { SiteIcon } from "@/components/layout/site-icon";
import { locale } from "@/i18n/request";
import { getSite } from "@/lib/sermo/site";
import "./globals.css";

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
  colorScheme: "dark",
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { maxUploadBytes } = await getSite();
  return (
    <html
      lang={locale}
      className={`dark ${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script, no visitor input */}
        <script dangerouslySetInnerHTML={{ __html: widthScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Suspense>
          <SiteIcon />
        </Suspense>
        <NextIntlClientProvider>
          <UploadLimitProvider bytes={maxUploadBytes}>
            {children}
          </UploadLimitProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
