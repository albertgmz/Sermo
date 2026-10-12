import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LiteStatus } from "@/app/(main)/lite/status";
import { LoadingRegion } from "@/components/forum/skeletons";
import { SocialIcon } from "@/components/forum/social-icon";
import { Container } from "@/components/layout/container";
import { Logo } from "@/components/layout/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { getLiteState } from "@/lib/lite-mode";
import { getCurrentUser } from "@/lib/session";

const SOCIALS = [
  { network: "discord", label: "Discord" },
  { network: "telegram", label: "Telegram" },
  { network: "x", label: "X" },
] as const;

const COLUMNS = [
  {
    title: "Community",
    links: [
      { label: "Forums", href: "/forums" },
      { label: "Members", href: "/members" },
      { label: "Awards", href: "/awards" },
    ],
  },
  {
    title: "Useful links",
    links: [
      { label: "Credits", href: "/credits" },
      { label: "Upgrade", href: "/upgrade" },
      { label: "Styleguide", href: "/ui" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms", href: "/terms" },
      { label: "Privacy", href: "/privacy" },
      { label: "Legal notice", href: "/legal" },
      { label: "Contact", href: "/contact" },
    ],
  },
];

export function SiteFooter() {
  const lite = useTranslations("lite.siteFooter");
  return (
    <footer className="mt-auto pt-12 pb-6 text-sm">
      <Container>
        <div className="grid gap-8 border-t pt-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,3fr)]">
          <div>
            <Logo className="-ml-1 px-1" />
            <p className="mt-1 max-w-xs text-pretty text-muted-foreground">
              A forum interface kit: reusable components, page templates and
              careful CSS.
            </p>
            <ul className="mt-2 -ml-2.5 flex items-center">
              {SOCIALS.map(({ network, label }) => (
                <li key={network}>
                  <Link
                    href="#"
                    aria-label={label}
                    className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <SocialIcon
                      network={network}
                      className="size-(--spacing-inline-icon)"
                    />
                  </Link>
                </li>
              ))}
            </ul>
            <Suspense
              fallback={
                <LoadingRegion label={lite("loadingLabel")}>
                  <div className="flex h-10 w-48 items-center">
                    <Skeleton className="h-4 w-full" />
                  </div>
                </LoadingRegion>
              }
            >
              <FooterLiteLink />
            </Suspense>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {COLUMNS.map(({ title, links }) => (
              <nav key={title} aria-label={title}>
                <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {title}
                </h2>
                <ul className="mt-1">
                  {links.map(({ label, href }) => (
                    <li key={href}>
                      <Link
                        href={href}
                        className="inline-flex h-10 items-center rounded-md font-medium transition-colors hover:text-primary md:h-8"
                      >
                        {label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <p className="mt-8 border-t pt-4 text-xs text-muted-foreground">
          © 2026 <span className="text-foreground">forum/ui</span>. All rights
          reserved.
        </p>
      </Container>
    </footer>
  );
}

async function FooterLiteLink() {
  const [state, user] = await Promise.all([getLiteState(), getCurrentUser()]);
  const t = await getTranslations("lite.siteFooter");
  return (
    <Link
      href={user ? "/account/lite" : "/lite"}
      className="flex min-h-10 w-48 items-center justify-between gap-2 rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span>{t("label")}</span>
      <span>
        <LiteStatus state={state} />
      </span>
    </Link>
  );
}
