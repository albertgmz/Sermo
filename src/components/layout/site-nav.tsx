"use client";

import { LayoutGrid, Menu, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/layout/logo";
import { isActivePath, NAV_LINKS, type NavLink } from "@/components/layout/nav";
import { Button } from "@/components/ui/button";
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

const MENU_LINKS: NavLink[] = [
  ...NAV_LINKS,
  { label: "Components", href: "/ui" },
];

export function SearchForm({ className }: { className?: string }) {
  return (
    <search className={className}>
      <form action="/search" className="relative">
        <Input
          type="search"
          name="q"
          placeholder="Search..."
          aria-label="Search"
          className="bg-card pr-10 md:pr-8 [&::-webkit-search-cancel-button]:hidden"
        />
        <Button
          type="submit"
          variant="secondary"
          size="icon-xs"
          aria-label="Submit search"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground md:right-1"
        >
          <Search />
        </Button>
      </form>
    </search>
  );
}

export function HeaderNav({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={cn("items-center gap-1", className)}>
      {NAV_LINKS.map((link) => (
        <Link
          key={link.label}
          href={link.href}
          aria-current={
            isActivePath(pathname, link.href, link.match) ? "page" : undefined
          }
          className={cn(
            "inline-flex h-10 items-center rounded-md border-b-2 border-transparent px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:bg-muted aria-[current=page]:text-foreground",
            link.highlight && "text-primary hover:text-primary/80",
          )}
        >
          {link.label}
        </Link>
      ))}
      <Link
        href="/ui"
        aria-label="Components"
        aria-current={isActivePath(pathname, "/ui") ? "page" : undefined}
        className="inline-flex size-10 items-center justify-center rounded-md border-b-2 border-transparent text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:bg-muted aria-[current=page]:text-foreground"
      >
        <LayoutGrid className="size-4" />
      </Link>
    </nav>
  );
}

export function MobileMenu({ className }: { className?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
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
          <SheetTitle render={<div />}>
            <Logo className="-ml-2 px-2" />
          </SheetTitle>
          <SheetDescription className="sr-only">
            Site navigation
          </SheetDescription>
        </SheetHeader>
        <div className="border-b p-4">
          <SearchForm />
        </div>
        <nav aria-label="Main" className="flex flex-col p-2">
          {MENU_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              onClick={() => setOpen(false)}
              aria-current={
                isActivePath(pathname, link.href, link.match)
                  ? "page"
                  : undefined
              }
              className={cn(
                "flex h-11 items-center rounded-md border-l-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:bg-muted aria-[current=page]:text-foreground",
                link.highlight && "text-primary",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
