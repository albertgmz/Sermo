import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// LinkCards: a grid of cards that each lead somewhere: the section landings and the panel's home.
// One column on a phone, two from 640 px, three from 1280 px. Server-safe.
//   label     The list's accessible name.
//   children  `LinkCard`s.
//
// LinkCard: one card, as a list item.
//   href         Where the card leads; the whole card is the link. Without it the card is plain.
//   icon         Optional lucide icon in front of the title.
//   title        The card's title.
//   description  Optional one-line description.
//   children     Optional links of its own under the description (the home lists a section's
//                screens there); they stay clickable above the card's link.

export function LinkCards({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <ul aria-label={label} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {children}
    </ul>
  );
}

export function LinkCard({
  href,
  icon: Icon,
  title,
  description,
  children,
}: {
  href?: string;
  icon?: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        "relative flex min-w-0 gap-3 rounded-lg border bg-card p-4 transition-colors",
        href && "hover:bg-muted",
      )}
    >
      {Icon && (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="size-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold [overflow-wrap:anywhere]">
          {href ? (
            <Link
              href={href}
              className="outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-ring"
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </p>
        {description && (
          <p className="mt-0.5 text-xs text-pretty text-muted-foreground">
            {description}
          </p>
        )}
        {children && <div className="relative mt-2">{children}</div>}
      </div>
    </li>
  );
}
