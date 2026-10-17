"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { NavSection } from "./navigation-data";
import { SECTION_ICONS } from "./section-icons";

// The screen the address belongs to: the longest listed path or section landing it is, or lies
// under. The home screen answers to its own address only, as every other address lies under it.
export function currentOf(pathname: string, sections: NavSection[]) {
  let best: { href: string; section: NavSection } | undefined;
  for (const section of sections) {
    const hrefs = section.screens.map((screen) => screen.href);
    if (section.href) hrefs.push(section.href);
    for (const href of hrefs) {
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

const HEADING =
  "flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-3 text-left text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";

// The sections of the panel as an accordion. The section of the current page is always open; a
// section's heading leads to its landing, and its arrow opens or closes it. The home, and a
// section whose landing is all the viewer may open, are plain links.
export function StaffNavigation({
  sections,
  label,
  onNavigate,
}: {
  sections: NavSection[];
  label: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations("admin.shell");
  const pathname = usePathname();
  const current = currentOf(pathname, sections);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      {sections.map((section) => {
        const Icon = SECTION_ICONS[section.id];
        const icon = <Icon aria-hidden="true" className="size-4 shrink-0" />;
        const isCurrent = current?.section.id === section.id;
        const only =
          section.id === "home"
            ? section.screens[0].href
            : section.screens.length === 0
              ? section.href
              : undefined;
        if (only) {
          return (
            <Link
              key={section.id}
              href={only}
              onClick={onNavigate}
              aria-current={current?.href === only ? "page" : undefined}
              className={cn(LINK, "gap-2 font-medium")}
            >
              {icon}
              {section.label}
            </Link>
          );
        }
        const open = isCurrent || opened.has(section.id);
        const panel = `staff-nav-${section.id}`;
        const toggle = () => {
          if (isCurrent) return;
          setOpened((previous) => {
            const next = new Set(previous);
            if (!next.delete(section.id)) next.add(section.id);
            return next;
          });
        };
        const chevron = (
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 transition-transform",
              open && "rotate-180",
            )}
          />
        );
        return (
          <div key={section.id}>
            {section.href ? (
              <div className="flex items-center">
                <Link
                  href={section.href}
                  onClick={onNavigate}
                  aria-current={
                    current?.href === section.href ? "page" : undefined
                  }
                  className={cn(
                    HEADING,
                    "aria-[current=page]:bg-muted",
                    isCurrent ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {icon}
                  <span className="min-w-0 truncate">{section.label}</span>
                </Link>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panel}
                  // The current section stays open: its arrow is not a working toggle.
                  aria-disabled={isCurrent || undefined}
                  aria-label={t("aria.toggleSection", {
                    section: section.label,
                  })}
                  onClick={toggle}
                  className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors not-aria-disabled:hover:bg-muted not-aria-disabled:hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {chevron}
                </button>
              </div>
            ) : (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panel}
                aria-disabled={isCurrent || undefined}
                onClick={toggle}
                className={cn(
                  HEADING,
                  "w-full justify-between",
                  isCurrent ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {icon}
                  <span className="truncate">{section.label}</span>
                </span>
                {chevron}
              </button>
            )}
            <div id={panel} hidden={!open} className="ml-5 border-l pl-1">
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
