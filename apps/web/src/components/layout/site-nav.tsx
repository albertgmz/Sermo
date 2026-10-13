"use client";

import { ChevronDown, Menu, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  hasHref,
  isCurrent,
  linkProps,
  type NavItem,
} from "@/components/layout/nav";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function SearchForm({ className }: { className?: string }) {
  const t = useTranslations("layout.siteNav");
  return (
    <search className={className}>
      <form action="/search" className="relative">
        <Input
          type="search"
          name="q"
          placeholder={t("placeholder")}
          aria-label={t("aria.search")}
          className="bg-card pr-10 md:pr-8 [&::-webkit-search-cancel-button]:hidden"
        />
        <Button
          type="submit"
          variant="secondary"
          size="icon-xs"
          aria-label={t("aria.submit")}
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground md:right-1"
        >
          <Search />
        </Button>
      </form>
    </search>
  );
}

const headerLink =
  "inline-flex h-10 items-center rounded-md border-b-2 border-transparent px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:bg-muted aria-[current=page]:text-foreground";

function HeaderEntry({ entry }: { entry: NavItem }) {
  const pathname = usePathname();
  if (entry.children.length > 0) {
    // A heading has no page of its own: its label opens the children. An entry with a page
    // keeps it as the first line of the menu.
    const current =
      isCurrent(pathname, entry) ||
      entry.children.some((child) => isCurrent(pathname, child));
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-current={current ? "page" : undefined}
          className={cn(
            headerLink,
            "group gap-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {entry.title}
          <ChevronDown className="size-3.5 transition-transform group-data-popup-open:rotate-180" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {[entry, ...entry.children].filter(hasHref).map((link) => (
            <DropdownMenuItem
              key={link.id}
              className="min-h-10 md:min-h-8"
              render={<Link {...linkProps(link)} />}
            >
              {link.title}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  if (!hasHref(entry))
    return (
      <span className={cn(headerLink, "cursor-default")}>{entry.title}</span>
    );
  return (
    <Link
      {...linkProps(entry)}
      aria-current={isCurrent(pathname, entry) ? "page" : undefined}
      className={headerLink}
    >
      {entry.title}
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

const menuLink =
  "flex h-11 items-center rounded-md border-l-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:bg-muted aria-[current=page]:text-foreground";

function MenuLink({
  entry,
  onNavigate,
}: {
  entry: NavItem;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  if (!hasHref(entry))
    return (
      <span className={cn(menuLink, "cursor-default")}>{entry.title}</span>
    );
  return (
    <Link
      {...linkProps(entry)}
      onClick={onNavigate}
      aria-current={isCurrent(pathname, entry) ? "page" : undefined}
      className={menuLink}
    >
      {entry.title}
    </Link>
  );
}

export function MobileMenu({
  links,
  className,
  logo,
}: {
  links: NavItem[];
  className?: string;
  logo: React.ReactNode;
}) {
  const t = useTranslations("layout.siteNav");
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("aria.open")}
            className={cn("size-10", className)}
          />
        }
      >
        <Menu className="size-6" />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(20rem,85vw)] gap-0 [&_[data-slot=sheet-close]]:top-2 [&_[data-slot=sheet-close]]:right-2 [&_[data-slot=sheet-close]]:size-10"
      >
        <SheetHeader className="border-b py-2">
          <SheetTitle render={<div />}>{logo}</SheetTitle>
          <SheetDescription className="sr-only">
            {t("description")}
          </SheetDescription>
        </SheetHeader>
        <div className="border-b p-4">
          <SearchForm />
        </div>
        <nav aria-label={t("aria.main")} className="flex flex-col p-2">
          {links.map((entry) => (
            <div key={entry.id} className="flex flex-col">
              <MenuLink entry={entry} onNavigate={() => setOpen(false)} />
              {entry.children.length > 0 && (
                <div className="ml-3 flex flex-col border-l">
                  {entry.children.map((child) => (
                    <MenuLink
                      key={child.id}
                      entry={child}
                      onNavigate={() => setOpen(false)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
