"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";

// A card that offers the visitor something the forum cannot do without them: installing it as an
// app, or turning on notifications. It floats above the content at the foot of the screen (above the
// phone's bottom bar), takes no focus and blocks nothing; "Not now" puts it away. One component for
// every such offer, so they look and behave alike.
export function PromptCard({
  icon,
  title,
  children,
  action,
  dismiss,
  busy = false,
  error,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  // The main button; absent when the card only explains (the iOS steps).
  action?: { label: string; onClick: () => void };
  dismiss: { label: string; onClick: () => void };
  busy?: boolean;
  error?: string | null;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-prompt-card=""
      className="fixed inset-x-3 bottom-[calc(var(--spacing-mobile-nav)+0.75rem)] z-40 animate-in rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg duration-300 fade-in slide-in-from-bottom-4 motion-reduce:animate-none md:inset-x-auto md:right-6 md:bottom-6 md:w-96"
    >
      <div className="flex gap-3">
        <div className="size-12 shrink-0 overflow-hidden rounded-xl">
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
        {action && (
          <Button
            onClick={action.onClick}
            disabled={busy}
            className="h-10 md:h-8"
          >
            {action.label}
          </Button>
        )}
      </div>
    </section>
  );
}
