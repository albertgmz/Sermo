import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { SocialIcon } from "@/components/forum/social-icon";
import { Container } from "@/components/layout/container";
import { Logo } from "@/components/layout/logo";
import { hasHref, type LinkItem, linkProps } from "@/components/layout/nav";
import { NavLabel } from "@/components/layout/nav-label";
import { toNavItems } from "@/components/layout/nav-server";
import { ThemeControl } from "@/components/layout/theme-control";
import { Skeleton } from "@/components/ui/skeleton";
import { getNavigation } from "@/lib/sermo/navigation";
import { getSite } from "@/lib/sermo/site";

const SOCIALS = [
  { network: "discord", label: "Discord" },
  { network: "telegram", label: "Telegram" },
  { network: "x", label: "X" },
] as const;

// What the loading state draws: the three columns of three links the site ships with.
const PLACEHOLDER_COLUMNS = [
  { column: 1, links: [1, 2, 3] },
  { column: 2, links: [1, 2] },
  { column: 3, links: [1, 2, 3, 4] },
];

// Two columns side by side on a phone, so the lists do not stack into one long strip.
const COLUMN_GRID =
  "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] sm:gap-6";

export function SiteFooter() {
  const t = useTranslations("layout.siteFooter");
  return (
    <footer className="mt-auto pt-12 pb-6 text-sm">
      <Container>
        <div className="grid gap-8 border-t pt-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,3fr)]">
          <div>
            <Logo className="-ml-1 px-1" />
            <Suspense>
              <FooterDescription />
            </Suspense>
            <Suspense>
              <FooterSocials />
            </Suspense>
          </div>
          <Suspense
            fallback={
              <LoadingRegion label={t("loadingLinks")}>
                <div className={COLUMN_GRID}>
                  {PLACEHOLDER_COLUMNS.map(({ column, links }) => (
                    <div key={column}>
                      <Skeleton className="h-4 w-24" />
                      <div className="mt-1">
                        {links.map((link) => (
                          <div
                            key={link}
                            className="flex h-10 items-center md:h-8"
                          >
                            <Skeleton className="h-4 w-20" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </LoadingRegion>
            }
          >
            <FooterColumns />
          </Suspense>
        </div>
        <Suspense
          fallback={
            <div className="mt-8 border-t pt-4">
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          }
        >
          <FooterCopyright />
        </Suspense>
      </Container>
    </footer>
  );
}

// What the site says about itself, when it says anything.
export async function FooterDescription() {
  const { description } = await getSite();
  if (!description) return null;
  return (
    <p className="mt-1 max-w-xs text-pretty text-muted-foreground">
      {description}
    </p>
  );
}

export async function FooterSocials() {
  const { socialLinks } = await getSite();
  const links = SOCIALS.flatMap((social) => {
    const href = socialLinks[social.network];
    return href ? [{ ...social, href }] : [];
  });
  if (links.length === 0) return null;
  return (
    <ul className="mt-2 -ml-2.5 flex items-center">
      {links.map(({ network, label, href }) => (
        <li key={network}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          >
            <SocialIcon
              network={network}
              className="size-(--spacing-inline-icon)"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}

const FOOTER_LINK =
  "inline-flex h-10 items-center gap-1.5 rounded-md font-medium transition-colors hover:text-primary-ink md:h-8";

function FooterLink({ link }: { link: LinkItem }) {
  return (
    <Link {...linkProps(link)} className={FOOTER_LINK}>
      <NavLabel item={link} />
    </Link>
  );
}

// A heading with links is a column. Entries that are links on their own share the last column.
export async function FooterColumns() {
  const [t, navigation] = await Promise.all([
    getTranslations("layout.siteFooter"),
    getNavigation(),
  ]);
  const entries = toNavItems(navigation.footer);
  const columns = entries.filter((entry) => entry.children.length > 0);
  const singles = entries.filter(
    (entry) => entry.children.length === 0 && hasHref(entry),
  );
  return (
    <div className={COLUMN_GRID}>
      {columns.map((column) => (
        <nav key={column.id} aria-label={column.title}>
          <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <NavLabel item={column} />
          </h2>
          <ul className="mt-1">
            {column.children.filter(hasHref).map((link) => (
              <li key={link.id}>
                <FooterLink link={link} />
              </li>
            ))}
          </ul>
        </nav>
      ))}
      {singles.length > 0 && (
        <nav aria-label={t("aria.more")}>
          <ul>
            {singles.filter(hasHref).map((link) => (
              <li key={link.id}>
                <FooterLink link={link} />
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

async function FooterCopyright() {
  const [t, site] = await Promise.all([
    getTranslations("layout.siteFooter"),
    getSite(),
  ]);
  return (
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <p className="text-xs text-muted-foreground">
        {t.rich("copyright", {
          site: site.name,
          brand: (chunks) => <span className="text-foreground">{chunks}</span>,
        })}
      </p>
      <ThemeControl />
      <ul className="flex basis-full flex-wrap gap-x-4">
        <li>
          <Link href="/cookies" className={FOOTER_LINK}>
            {t("cookiePolicy")}
          </Link>
        </li>
        <li>
          <button
            type="button"
            data-consent-settings=""
            className={FOOTER_LINK}
          >
            {t("cookieSettings")}
          </button>
        </li>
      </ul>
    </div>
  );
}
