"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  hasHref,
  isCurrent,
  linkProps,
  type NavItem,
} from "@/components/layout/nav";
import { NavLabel } from "@/components/layout/nav-label";
import { SearchForm } from "@/components/layout/site-search-form";
import { Button } from "@/components/ui/button";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { usePopupFocus } from "@/components/ui/lazy-popup-focus";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const menuLink =
  "flex h-11 items-center gap-2 rounded-md border-l-2 border-transparent px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:bg-muted aria-[current=page]:text-foreground";

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
      <span className={cn(menuLink, "cursor-default")}>
        <NavLabel item={entry} />
      </span>
    );
  return (
    <Link
      {...linkProps(entry)}
      onClick={onNavigate}
      aria-current={isCurrent(pathname, entry) ? "page" : undefined}
      className={menuLink}
    >
      <NavLabel item={entry} />
    </Link>
  );
}

export type MobileMenuPopupProps = {
  links: NavItem[];
  className?: string;
  logo: React.ReactNode;
  labels: {
    open: string;
    main: string;
    description: string;
  };
};

// The phone's navigation button and the sheet it opens, which Base UI draws. It is loaded when the
// plain button of `MobileMenu` is pressed and mounts open.
export default function MobileMenuPopup({
  links,
  className,
  logo,
  labels,
  openedBy,
}: MobileMenuPopupProps & OpenedProps) {
  const focus = usePopupFocus(openedBy);
  const [open, setOpen] = useState(true);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={labels.open}
            className={cn("size-10", className)}
          />
        }
      >
        <Menu className="size-6" />
      </SheetTrigger>
      <SheetContent
        side="left"
        ref={focus.ref}
        initialFocus={focus.initialFocus}
        className="w-[min(20rem,85vw)] gap-0 [&_[data-slot=sheet-close]]:top-2 [&_[data-slot=sheet-close]]:right-2 [&_[data-slot=sheet-close]]:size-10"
      >
        <SheetHeader className="border-b py-2">
          <SheetTitle render={<div />}>{logo}</SheetTitle>
          <SheetDescription className="sr-only">
            {labels.description}
          </SheetDescription>
        </SheetHeader>
        <div className="border-b p-4">
          <SearchForm />
        </div>
        <nav aria-label={labels.main} className="flex flex-col p-2">
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
