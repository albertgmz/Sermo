import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LiteStatus } from "@/app/(main)/lite/status";
import { LoadingRegion } from "@/components/forum/skeletons";
import { SocialIcon } from "@/components/forum/social-icon";
import { Container } from "@/components/layout/container";
import { Logo } from "@/components/layout/logo";
import {
  hasHref,
  type LinkItem,
  linkProps,
  toNavItems,
} from "@/components/layout/nav";
import { Skeleton } from "@/components/ui/skeleton";
import { getLiteState } from "@/lib/lite-mode";
import { getNavigation } from "@/lib/sermo/navigation";
import { getViewer } from "@/lib/sermo/session";
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

const COLUMN_GRID =
  "grid gap-6 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]";

export function SiteFooter() {
  const t = useTranslations("layout.siteFooter");
  const lite = useTranslations("lite.siteFooter");
  return (
    <footer className="mt-auto pt-12 pb-6 text-sm">
      <Container>
        <div className="grid gap-8 border-t pt-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,3fr)]">
          <div>
            <Logo className="-ml-1 px-1" />
            <p className="mt-1 max-w-xs text-pretty text-muted-foreground">
              {t("tagline")}
            </p>
            <Suspense>
              <FooterSocials />
            </Suspense>
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
  "inline-flex h-10 items-center rounded-md font-medium transition-colors hover:text-primary md:h-8";

function FooterLink({ link }: { link: LinkItem }) {
  return (
    <Link {...linkProps(link)} className={FOOTER_LINK}>
      {link.title}
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
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {column.title}
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
    <p className="mt-8 border-t pt-4 text-xs text-muted-foreground">
      {t.rich("copyright", {
        site: site.name,
        brand: (chunks) => <span className="text-foreground">{chunks}</span>,
      })}
    </p>
  );
}

async function FooterLiteLink() {
  const [state, { user }] = await Promise.all([getLiteState(), getViewer()]);
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
