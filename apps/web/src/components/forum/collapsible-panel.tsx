"use client";

import { ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { cn } from "@/lib/utils";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function writeOpen(storageKey: string, open: boolean) {
  localStorage.setItem(storageKey, open ? "1" : "0");
  for (const listener of listeners) listener();
}

// A closed panel's body stays in the page for the browser's find (Ctrl+F) and for links to text
// in it: hidden until found, when the browser shows it and fires `beforematch`. React writes
// `hidden` only as a boolean, so the attribute is set here.
export function foldPanel(
  body: Pick<Element, "setAttribute" | "removeAttribute">,
  closed: boolean,
) {
  if (closed) body.setAttribute("hidden", "until-found");
  else body.removeAttribute("hidden");
}

// Until the member chooses, a panel is open everywhere ("always") or open
// from `md` and closed on phones ("md"). The choice is kept per storage key.
export function CollapsiblePanel({
  title,
  storageKey,
  defaultOpen = "always",
  children,
}: {
  title: string;
  storageKey: string;
  defaultOpen?: "always" | "md";
  children: React.ReactNode;
}) {
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  // Null on the server, where the same default is applied with CSS alone.
  const open = useSyncExternalStore<boolean | null>(
    subscribe,
    () => {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) return stored === "1";
      return (
        defaultOpen === "always" || matchMedia("(min-width: 48rem)").matches
      );
    },
    () => null,
  );
  const responsive = open === null && defaultOpen === "md";
  const shown = open ?? true;
  const closed = open === false;
  useLayoutEffect(() => {
    if (body.current) foldPanel(body.current, closed);
  }, [closed]);
  // Text found in a closed panel opens it, as a press would.
  useEffect(() => {
    const panel = body.current;
    if (!panel) return;
    const found = () => writeOpen(storageKey, true);
    panel.addEventListener("beforematch", found);
    return () => panel.removeEventListener("beforematch", found);
  }, [storageKey]);
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <h2>
        <button
          type="button"
          aria-expanded={open ?? undefined}
          aria-controls={id}
          onClick={() => writeOpen(storageKey, !open)}
          className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {title}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              responsive ? "md:rotate-180" : shown && "rotate-180",
            )}
          />
        </button>
      </h2>
      <div
        ref={body}
        id={id}
        className={cn(!closed && "border-t", responsive && "hidden md:block")}
      >
        {children}
      </div>
    </section>
  );
}
