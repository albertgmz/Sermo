"use client";

import Link from "next/link";
import { useId } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A card that offers the visitor something the forum cannot do without them: installing it as an
// app, turning on notifications, or (for a guest) creating an account. It floats above the content
// at the foot of the screen (above the phone's bottom bar), takes no focus and blocks nothing; "Not
// now" puts it away, as does Escape from inside it. It steps aside while the notice of a popup that
// could not load is up (the same corner). One component for every such offer, so they look and
// behave alike. `inline` sets it in the flow of the page instead, for the styleguide. The main
// action is a button, or a link to another page (`href`); `secondary` is a second link, drawn as an
// outlined button before it.
export function PromptCard({
  icon,
  title,
  children,
  action,
  secondary,
  dismiss,
  busy = false,
  error,
  inline = false,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  // The main button; absent when the card only explains (the iOS steps).
  action?: { label: string } & ({ onClick: () => void } | { href: string });
  secondary?: { label: string; href: string };
  dismiss: { label: string; onClick: () => void };
  busy?: boolean;
  error?: string | null;
  inline?: boolean;
  className?: string;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-prompt-card=""
      onKeyDown={(event) => {
        if (event.key === "Escape") dismiss.onClick();
      }}
      className={cn(
        "[body:has([data-lazy-popup-notice])_&]:hidden animate-in rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg duration-300 fade-in slide-in-from-bottom-4 motion-reduce:animate-none",
        inline
          ? "w-full max-w-sm"
          : "fixed inset-x-3 bottom-[calc(var(--spacing-mobile-nav)+0.75rem)] z-40 md:inset-x-auto md:right-6 md:bottom-6 md:w-96",
        className,
      )}
    >
      <div className="flex gap-3">
        <div className="size-12 shrink-0 overflow-hidden rounded-xl ring-1 ring-border">
          {icon}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id={titleId} className="text-sm font-semibold text-pretty">
            {title}
          </h2>
          <div className="text-sm text-pretty text-muted-foreground">
            {children}
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={dismiss.onClick}
          className="h-10 md:h-8"
        >
          {dismiss.label}
        </Button>
        {secondary && (
          <Link
            href={secondary.href}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-10 md:h-8",
            )}
          >
            {secondary.label}
          </Link>
        )}
        {action &&
          ("href" in action ? (
            <Link
              href={action.href}
              className={cn(buttonVariants(), "h-10 md:h-8")}
            >
              {action.label}
            </Link>
          ) : (
            <Button
              onClick={action.onClick}
              disabled={busy}
              className="h-10 md:h-8"
            >
              {action.label}
            </Button>
          ))}
      </div>
    </section>
  );
}
