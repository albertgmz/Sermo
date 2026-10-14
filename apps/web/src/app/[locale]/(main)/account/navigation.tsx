"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { SettingsGroup, SettingsLinkRow } from "@/components/forum/settings";

const GROUPS = [
  {
    title: "accountHeading",
    links: [
      { label: "profile", href: "/account" },
      { label: "bookmarks", href: "/account/bookmarks" },
    ],
  },
  {
    title: "settingsHeading",
    links: [
      { label: "privacy", href: "/account/privacy" },
      { label: "notifications", href: "/account/notifications" },
      { label: "preferences", href: "/account/preferences" },
      { label: "perks", href: "/account/permissions" },
      // Labelled from the LITE messages.
      { label: null, href: "/account/lite" },
      { label: "security", href: "/account/security" },
    ],
  },
] as const;

// The same links as rows, for the settings screen: every screen the navigation lists except the
// settings screen itself.
type AccountLink = (typeof GROUPS)[number]["links"][number];

export function AccountLinks() {
  const t = useTranslations("account.navigation");
  const lite = useTranslations("lite.navigation");
  const links = GROUPS.flatMap((group): AccountLink[] => [
    ...group.links,
  ]).filter(({ href }) => href !== "/account");
  return (
    <SettingsGroup
      id="more"
      heading={useTranslations("account.profile")("moreGroup")}
    >
      {links.map(({ label, href }) => (
        <SettingsLinkRow key={href} href={href}>
          {label ? t(label) : lite("label")}
        </SettingsLinkRow>
      ))}
    </SettingsGroup>
  );
}

export function AccountNavigation() {
  const pathname = usePathname();
  const t = useTranslations("account.navigation");
  const lite = useTranslations("lite.navigation");

  return (
    <nav
      aria-label={t("aria.label")}
      className="relative flex overflow-x-auto rounded-lg border bg-card lg:block lg:overflow-visible"
    >
      {GROUPS.map(({ title, links }) => (
        <section
          key={title}
          className="shrink-0 border-r last:border-r-0 lg:border-r-0 lg:not-first:border-t"
        >
          <h2 className="sr-only lg:not-sr-only lg:border-b lg:px-4 lg:py-3 lg:text-sm lg:font-semibold">
            {t(title)}
          </h2>
          <ul className="flex gap-1 p-1.5 lg:block lg:space-y-1 lg:p-2">
            {links.map(({ label, href }) => (
              <li key={href}>
                <Link
                  href={href}
                  ref={
                    pathname === href
                      ? (link) => {
                          link?.scrollIntoView({
                            block: "nearest",
                            inline: "nearest",
                          });
                        }
                      : undefined
                  }
                  aria-current={pathname === href ? "page" : undefined}
                  className="flex min-h-10 items-center rounded-md border border-transparent px-3 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:border-border aria-[current=page]:bg-muted aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
                >
                  {label ? t(label) : lite("label")}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
