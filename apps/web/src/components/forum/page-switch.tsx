"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { jumpPage, pageOfSearch } from "@/components/forum/page-window";
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

type Shown = { page: number; node: ReactNode };

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
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // The page on screen, for the history listener; the newest request, so an answer that comes
  // after a later press is dropped; whether the next page drawn is to be scrolled to.
  const showing = useRef(page);
  showing.current = shown?.page ?? page;
  const asked = useRef(0);
  const arrived = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new draw of the screen resets
  useEffect(() => {
    asked.current += 1;
    setShown(null);
    setBusy(false);
  }, [stamp]);

  const show = useCallback(
    async (target: number) => {
      const ticket = ++asked.current;
      if (target === page) {
        setShown(null);
        setBusy(false);
        arrived.current = true;
        return;
      }
      setBusy(true);
      let node: ReactNode | null = null;
      try {
        node = await load(target);
      } catch {
        node = null;
      }
      if (ticket !== asked.current) return;
      if (node === null) {
        // The address is already the page's: opened as a page of its own.
        location.reload();
        return;
      }
      arrived.current = true;
      setShown({ page: target, node });
      setBusy(false);
    },
    [page, load],
  );

  // Back, Forward, and coming back to this screen from another: the address names the page to show.
  useEffect(() => {
    const path = location.pathname;
    const follow = () => {
      if (location.pathname !== path) return;
      const wanted = pageOfSearch(location.search, param);
      if (wanted !== showing.current) void show(wanted);
    };
    follow();
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, [param, show]);

  // A page that came in starts at its top, as a page loaded anew would; the keyboard goes there too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs for each page shown
  useLayoutEffect(() => {
    const node = box.current;
    if (!arrived.current || !node) return;
    arrived.current = false;
    const header = Number.parseFloat(
      getComputedStyle(document.documentElement).scrollPaddingTop,
    );
    if (node.getBoundingClientRect().top < (header || 0))
      node.scrollIntoView({ block: "start" });
    node.focus({ preventScroll: true });
  }, [shown]);

  function go(target: number, href: string) {
    if (target === showing.current) {
      box.current?.scrollIntoView({ block: "start" });
      return;
    }
    window.history.pushState(null, "", href);
    void show(target);
  }

  function onClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const target = event.target as Element;
    const link = target.closest<HTMLAnchorElement>("a[data-page]");
    if (link && box.current?.contains(link)) {
      event.preventDefault();
      go(Number(link.dataset.page), link.href);
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
      field?.focus();
      return;
    }
    submit.closest("details")?.removeAttribute("open");
    const url = new URL(form.action);
    for (const [key, value] of new FormData(form))
      if (key !== param) url.searchParams.append(key, String(value));
    if (wanted > 1) url.searchParams.set(param, String(wanted));
    go(wanted, `${url.pathname}${url.search}`);
  }

  // "Go to page" opens with its box ready to type in, and closes on Escape or a press elsewhere.
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
    node.addEventListener("toggle", onToggle, true);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("toggle", onToggle, true);
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
      aria-busy={busy || undefined}
      onClick={onClick}
      className={cn(
        "scroll-mt-4 outline-none transition-opacity",
        busy && "opacity-60",
        className,
      )}
    >
      {shown ? shown.node : children}
    </div>
  );
}
