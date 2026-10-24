"use client";

import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { jumpPage, pageOfSearch } from "@/components/forum/page-window";
import { usePlaceSwitch } from "@/components/forum/use-place-switch";
import { cn } from "@/lib/utils";

// PageSwitch: the part of a screen that a numbered pager (`PageNav`) turns the pages of, changed in
// place. A press on one of its pager links, or "go to page", puts the page's address in the history
// (`pushState`, which Next follows) and asks `load` for that page, drawn on the server; the rest of
// the screen stays as it is (no route skeleton, no redraw of the whole screen, a reply being typed
// below keeps its text). Back and Forward show the page their address names the same way. The
// links stay plain links: a press with a modifier key, or a browser without scripts, opens them.
//
// Props
//   page      The page the server drew (the children).
//   stamp     Which draw of the screen the children are from: a new one (the server drew the
//             screen again) shows them instead of a page loaded here.
//   load      A page by its number, drawn; null when there is no such page to show in place
//             (the address is then opened as a page of its own, which says what is the matter).
//   param     Name of the page parameter. Default "page".

export function PageSwitch({
  page,
  stamp,
  load,
  param = "page",
  children,
  className,
}: {
  page: number;
  stamp: number;
  load: (page: number) => Promise<ReactNode | null>;
  param?: string;
  children: ReactNode;
  className?: string;
}) {
  const placeOf = useCallback(
    (search: string) => String(pageOfSearch(search, param)),
    [param],
  );
  const loadPlace = useCallback((place: string) => load(Number(place)), [load]);
  const box = useRef<HTMLDivElement>(null);
  const switched = usePlaceSwitch({
    box,
    place: String(page),
    stamp,
    load: loadPlace,
    placeOf,
    // A page that came in starts at its top, as a page loaded anew would; the keyboard goes there
    // too.
    arrive: (node) => {
      const header = Number.parseFloat(
        getComputedStyle(document.documentElement).scrollPaddingTop,
      );
      if (node.getBoundingClientRect().top < (header || 0))
        node.scrollIntoView({ block: "start" });
      node.focus({ preventScroll: true });
    },
    // The address keeps the path the screen is at (a thread's is the slugged one the server sent
    // it to); only the query changes.
    pushed: (url) => `${location.pathname}${url.search}`,
  });

  function go(href: string) {
    if (!switched.go(href)) box.current?.scrollIntoView({ block: "start" });
  }

  function onClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const target = event.target as Element;
    const link = target.closest<HTMLAnchorElement>("a[data-page]");
    if (link && box.current?.contains(link)) {
      event.preventDefault();
      go(link.href);
      return;
    }
    // "Go to page": pressing Go, or Enter in the box (the browser presses Go for it).
    const submit = target.closest<HTMLButtonElement>("button[data-page-go]");
    const form = submit?.form;
    if (!submit || !form) return;
    event.preventDefault();
    const field = form.elements.namedItem(param) as HTMLInputElement | null;
    const wanted = jumpPage(field?.value ?? "", Number(submit.dataset.pageGo));
    if (wanted === null) {
      // The browser says what is wrong with it, as it would for the form sent without scripts.
      field?.reportValidity();
      field?.focus();
      return;
    }
    submit.closest("details")?.removeAttribute("open");
    const url = new URL(form.action);
    for (const [key, value] of new FormData(form))
      if (key !== param) url.searchParams.append(key, String(value));
    if (wanted > 1) url.searchParams.set(param, String(wanted));
    go(`${url.pathname}${url.search}`);
  }

  // "Go to page" opens with its box ready to type in, and closes on Escape, a press elsewhere or
  // the keyboard leaving it.
  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const open = () =>
      node.querySelectorAll<HTMLDetailsElement>(
        "details[data-page-jump][open]",
      );
    const onToggle = (event: Event) => {
      const details = event.target as HTMLDetailsElement;
      if (!details.matches("details[data-page-jump]") || !details.open) return;
      for (const other of open()) if (other !== details) other.open = false;
      const field =
        details.querySelector<HTMLInputElement>("input[type=number]");
      field?.focus();
      field?.select();
    };
    const onPointer = (event: PointerEvent) => {
      for (const details of open())
        if (!details.contains(event.target as Node)) details.open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      for (const details of open()) {
        details.open = false;
        details.querySelector("summary")?.focus();
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      const details = (event.target as Element).closest?.(
        "details[data-page-jump][open]",
      ) as HTMLDetailsElement | null;
      // Only a move to somewhere else: a press on Go in Safari moves the focus nowhere.
      const to = event.relatedTarget as Node | null;
      if (details && to && !details.contains(to)) details.open = false;
    };
    node.addEventListener("toggle", onToggle, true);
    node.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("toggle", onToggle, true);
      node.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the presses are its links' and buttons', caught on their way up
    // biome-ignore lint/a11y/useKeyWithClickEvents: links and buttons send a click for Enter themselves
    <div
      ref={box}
      tabIndex={-1}
      aria-busy={switched.busy || undefined}
      onClick={onClick}
      className={cn(
        "scroll-mt-4 outline-none transition-opacity",
        switched.busy && "opacity-60",
        className,
      )}
    >
      {switched.node ?? children}
    </div>
  );
}
