"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { NavSection } from "./navigation-data";

// The screen the address belongs to: the longest listed path it is, or lies under. The home
// screen answers to its own address only, as every other address lies under it.
export function currentOf(pathname: string, sections: NavSection[]) {
  let best: { href: string; section: NavSection } | undefined;
  for (const section of sections) {
    for (const { href } of section.screens) {
      const under =
        pathname === href ||
        (href !== "/admin" && pathname.startsWith(`${href}/`));
      if (under && (!best || href.length > best.href.length)) {
        best = { href, section };
      }
    }
  }
  return best;
}

const LINK =
  "flex min-h-10 items-center rounded-md border-l-2 border-transparent px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:border-primary aria-[current=page]:bg-muted aria-[current=page]:font-semibold aria-[current=page]:text-foreground";

// The sections of the panel as a list with collapsible sections. The section of the current
// screen is always open; the home section is a plain link.
export function StaffNavigation({
  sections,
  label,
  onNavigate,
}: {
  sections: NavSection[];
  label: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const current = currentOf(pathname, sections);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      {sections.map((section) => {
        if (section.id === "home") {
          const [screen] = section.screens;
          return (
            <Link
              key={section.id}
              href={screen.href}
              onClick={onNavigate}
              aria-current={current?.href === screen.href ? "page" : undefined}
              className={cn(LINK, "font-medium")}
            >
              {section.label}
            </Link>
          );
        }
        const isCurrent = current?.section.id === section.id;
        const open = isCurrent || opened.has(section.id);
        const panel = `staff-nav-${section.id}`;
        return (
          <div key={section.id}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panel}
              onClick={() => {
                if (isCurrent) return;
                setOpened((previous) => {
                  const next = new Set(previous);
                  if (!next.delete(section.id)) next.add(section.id);
                  return next;
                });
              }}
              className={cn(
                "flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
                isCurrent ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {section.label}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
            <div id={panel} hidden={!open} className="ml-3 border-l pl-1">
              {section.screens.map((screen, index) => (
                <div key={screen.href}>
                  {screen.group &&
                    section.screens[index - 1]?.group?.id !==
                      screen.group.id && (
                      <p className="px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {screen.group.label}
                      </p>
                    )}
                  <Link
                    href={screen.href}
                    onClick={onNavigate}
                    aria-current={
                      current?.href === screen.href ? "page" : undefined
                    }
                    className={LINK}
                  >
                    {screen.label}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
