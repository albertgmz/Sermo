"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const GROUPS = [
  {
    title: "accountHeading",
    links: [{ label: "overview", href: "/account" }],
  },
  {
    title: "settingsHeading",
    links: [
      { label: "appearance", href: "/account/appearance" },
      { label: "permissions", href: "/account/permissions" },
      { label: "security", href: "/account/security" },
    ],
  },
] as const;

export function AccountNavigation() {
  const pathname = usePathname();
  const t = useTranslations("account.navigation");

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
                  {t(label)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
