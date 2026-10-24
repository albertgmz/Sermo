"use client";

import { Check } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

// The line at the top of a page that says what the member just did on it (bought, wore, upgraded).
// A form whose action answered with a notice says so here (`announce`), in place: the page is not
// opened again for it, so the line floats in view under the header, wherever the member is on the
// page, as XenForo's flash message does, and goes after a few seconds (it takes no room, so
// nothing moves when it goes). `drawn` is the notice the address
// names (`?notice=`, an older link), drawn as a plain line. `texts` holds the words of each notice
// the page knows; any other draws nothing.

// How long a notice said in place stays.
const SHOWN_MS = 6000;

let announced: string | null = null;
const listeners = new Set<() => void>();

export function announce(notice: string | null) {
  announced = notice;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function PageNotice({
  drawn,
  texts,
  className,
}: {
  drawn?: string;
  texts: Record<string, string>;
  className?: string;
}) {
  const said = useSyncExternalStore(
    subscribe,
    () => announced,
    () => null,
  );
  // A notice belongs to the page it was said on.
  useEffect(() => () => announce(null), []);
  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => announce(null), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [said]);
  const textOf = (notice: string | null | undefined) =>
    notice && Object.hasOwn(texts, notice) ? texts[notice] : null;
  const line = (text: string, floating: boolean) => (
    <output
      className={cn(
        "flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-pretty",
        // Opaque under its tint, as it floats over the page.
        floating &&
          "fixed inset-x-4 top-[calc(var(--spacing-site-header)+0.5rem)] z-50 mx-auto max-w-md bg-[color-mix(in_oklab,var(--success)_10%,var(--background))] shadow-md",
        className,
      )}
    >
      <Check
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-success"
      />
      {text}
    </output>
  );
  const inline = textOf(drawn);
  const floating = textOf(said);
  return (
    <>
      {inline && line(inline, false)}
      {floating && line(floating, true)}
    </>
  );
}

// For a form: says its action's notice once the answer is in.
export function useAnnounce(notice: string | undefined, answer: object) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: each answer is said, also a repeat
  useEffect(() => {
    if (notice) announce(notice);
  }, [answer]);
}
