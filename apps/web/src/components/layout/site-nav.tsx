"use client";

import { ChevronDown, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { HeaderMenuPopupProps } from "@/components/layout/header-menu-popup";
import type { MobileMenuPopupProps } from "@/components/layout/mobile-menu-popup";
import {
  hasHref,
  isCurrent,
  linkProps,
  type NavItem,
} from "@/components/layout/nav";
import { NavLabel } from "@/components/layout/nav-label";
import { buttonVariants } from "@/components/ui/button";
import { LazyPopup } from "@/components/ui/lazy-popup";
import type { LiteState } from "@/lib/lite-preferences";
import { cn } from "@/lib/utils";

// The menus' code (Base UI) is fetched when a heading or the phone's menu button is first reached
// for; until then each is a plain button.
const loadHeaderMenu = () => import("@/components/layout/header-menu-popup");
const loadMobileMenu = () => import("@/components/layout/mobile-menu-popup");

const headerLink =
  "inline-flex h-10 items-center gap-1.5 rounded-md border-b-2 border-transparent px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:bg-muted aria-[current=page]:text-foreground";

const headingLink = cn(
  headerLink,
  "group gap-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

function HeaderEntry({ entry }: { entry: NavItem }) {
  const pathname = usePathname();
  if (entry.children.length > 0) {
    // A heading has no page of its own: its label opens the children. An entry with a page
    // keeps it as the first line of the menu.
    const current =
      isCurrent(pathname, entry) ||
      entry.children.some((child) => isCurrent(pathname, child));
    const popup: HeaderMenuPopupProps = {
      entry,
      current,
      className: headingLink,
    };
    return (
      <LazyPopup
        load={loadHeaderMenu}
        popup={popup}
        opening="menu"
        trigger={(lazy) => (
          <button
            type="button"
            data-slot="dropdown-menu-trigger"
            aria-haspopup="menu"
            aria-expanded="false"
            aria-current={current ? "page" : undefined}
            className={headingLink}
            {...lazy}
          >
            <NavLabel item={entry} />
            <ChevronDown className="size-3.5 transition-transform group-data-popup-open:rotate-180" />
          </button>
        )}
      />
    );
  }
  if (!hasHref(entry))
    return (
      <span className={cn(headerLink, "cursor-default")}>
        <NavLabel item={entry} />
      </span>
    );
  return (
    <Link
      {...linkProps(entry)}
      aria-current={isCurrent(pathname, entry) ? "page" : undefined}
      className={headerLink}
    >
      <NavLabel item={entry} />
    </Link>
  );
}

export function HeaderNav({
  links,
  className,
}: {
  links: NavItem[];
  className?: string;
}) {
  const t = useTranslations("layout.siteNav");
  return (
    <nav
      aria-label={t("aria.main")}
      className={cn("items-center gap-1", className)}
    >
      {links.map((entry) => (
        <HeaderEntry key={entry.id} entry={entry} />
      ))}
    </nav>
  );
}

export function MobileMenu({
  links,
  className,
  logo,
  dataSaver,
}: {
  links: NavItem[];
  className?: string;
  logo: React.ReactNode;
  dataSaver?: LiteState;
}) {
  const t = useTranslations("layout.siteNav");
  const popup: MobileMenuPopupProps = {
    links,
    className,
    logo,
    dataSaver,
    labels: {
      open: t("aria.open"),
      main: t("aria.main"),
      description: t("description"),
    },
  };
  return (
    <LazyPopup
      load={loadMobileMenu}
      popup={popup}
      trigger={(lazy) => (
        <button
          type="button"
          data-slot="sheet-trigger"
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-label={t("aria.open")}
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "size-10",
            className,
          )}
          {...lazy}
        >
          <Menu className="size-6" />
        </button>
      )}
    />
  );
}
