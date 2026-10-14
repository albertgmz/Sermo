// The layout of an app-like settings screen: groups of rows in one rounded card each. Server-safe
// (the autosaving rows in autosave.tsx wrap SettingsRow).

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function SettingsGroup({
  id,
  heading,
  description,
  children,
}: {
  id?: string;
  heading: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="min-w-0 scroll-mt-4 space-y-2">
      <div className="px-1">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {heading}
        </h2>
        {description && (
          <p className="text-xs text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {children}
      </div>
    </section>
  );
}

// One setting: its name and a line of help on the left, its state ("Saving…", "Saved", a refusal)
// on the right, and the control under both.
export function SettingsRow({
  id,
  title,
  description,
  htmlFor,
  status,
  className,
  children,
}: {
  id?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  // The control a label belongs to, where there is one.
  htmlFor?: string;
  status?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const heading = "text-sm font-medium";
  return (
    <div id={id} className={cn("scroll-mt-4 space-y-3 p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-48">
          {htmlFor ? (
            <label htmlFor={htmlFor} className={cn(heading, "block")}>
              {title}
            </label>
          ) : (
            <h3 className={heading}>{title}</h3>
          )}
          {description && (
            <p className="text-xs text-pretty text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {status}
      </div>
      {children}
    </div>
  );
}

// A row that opens another screen.
export function SettingsLinkRow({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-12 items-center justify-between gap-3 px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
      />
    </Link>
  );
}
