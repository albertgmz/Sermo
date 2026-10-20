"use client";

import {
  Fragment,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { holdEnv } from "@/components/layout/hash-target";
import {
  createScrollHolder,
  HOLD_MAX_MS,
  HOLD_QUIET_MS,
} from "@/components/layout/spotlight";

// The older comments, drawn by the server one row each, from the newest down to `oldest` (the
// oldest comment read, which the next batch goes past); `nextCursor` is null when none is left.
export type EarlierPage = {
  rows: { id: number; node: ReactNode }[];
  nextCursor: string | null;
  oldest: number | null;
};

// Whether a picture can still move the comments: one that is loading, or a lazy one on the screen
// (a lazy one away from it is not loaded at all, and is not waited for).
function stillLoading(image: HTMLImageElement) {
  if (image.complete) return false;
  if (image.loading !== "lazy") return true;
  const box = image.getBoundingClientRect();
  return box.bottom > 0 && box.top < window.innerHeight;
}

// "Show more comments" under a wall post: each press loads the batch before the oldest comment
// shown and inserts it above, where the list starts, and the page keeps still around what the
// reader was looking at: the comment that was first stays where it was on the screen, also while
// the pictures of the batch load, until the reader acts (WebKit has no scroll anchoring of its
// own). Nothing is navigated to, so nothing scrolls or dims. The button goes once every comment
// is shown, and the keyboard's focus goes to the oldest comment.
//
// The page drawn again (a new comment, an edit, a deletion) gives a new `load`: the comments
// loaded are read again down to the same one, so they match it, and a row the server list now
// draws itself (`shown`) is never drawn twice.
export function EarlierComments({
  load,
  shown,
  label,
  className,
}: {
  load: (through: number | null) => Promise<EarlierPage>;
  // The ids of the comments the server list draws.
  shown: number[];
  label: string;
  className?: string;
}) {
  const [page, setPage] = useState<EarlierPage | null>(null);
  const [pending, startTransition] = useTransition();
  const button = useRef<HTMLButtonElement>(null);
  // The comment that was first before a batch went in, where it was on the screen, and whether
  // the button had the keyboard's focus.
  const kept = useRef<{ element: Element; top: number; focus: boolean } | null>(
    null,
  );
  const holder = useRef<ReturnType<typeof createScrollHolder>>(null);
  // Answers are taken in the order asked: a later one replaces an earlier one still on its way.
  const asked = useRef(0);
  const loaded = useRef(page);
  loaded.current = page;
  useEffect(() => () => holder.current?.stop(), []);

  // A new `load` is the list drawn again: what was loaded is read again.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const before = loaded.current;
    if (before === null) return;
    const ask = ++asked.current;
    load(before.oldest)
      .then((again) => {
        if (ask === asked.current) setPage(again);
      })
      .catch(() => {});
  }, [load]);

  // Runs once a batch is in, before it is painted.
  useLayoutEffect(() => {
    const anchor = kept.current;
    kept.current = null;
    if (!anchor?.element.isConnected) return;
    const { element, top } = anchor;
    const list = element.parentElement;
    if (anchor.focus && page?.nextCursor === null) {
      const oldest = list?.querySelector<HTMLElement>(
        '[id^="profile-comment-"]',
      );
      if (oldest) {
        oldest.tabIndex = -1;
        oldest.focus({ preventScroll: true });
      }
    }
    holder.current?.stop();
    holder.current = createScrollHolder({
      ...holdEnv,
      // Settled once the pictures of the list that can still move it are in.
      loaded: () =>
        ![...(list?.querySelectorAll("img") ?? [])].some(stillLoading),
    });
    holder.current.hold(
      () =>
        element.isConnected
          ? window.scrollY + element.getBoundingClientRect().top - top
          : null,
      { quietMs: HOLD_QUIET_MS, maxMs: HOLD_MAX_MS },
    );
  }, [page]);

  const more = () =>
    startTransition(async () => {
      const ask = ++asked.current;
      let next: EarlierPage;
      try {
        next = await load(page?.oldest == null ? null : page.oldest - 1);
      } catch {
        // The button stays for another try.
        return;
      }
      if (ask !== asked.current) return;
      const firstRow = button.current?.parentElement?.querySelector(
        '[id^="profile-comment-"]',
      );
      kept.current = firstRow
        ? {
            element: firstRow,
            top: firstRow.getBoundingClientRect().top,
            focus: document.activeElement === button.current,
          }
        : null;
      setPage(next);
    });

  const drawn = new Set(shown);
  return (
    <>
      {page?.nextCursor !== null && (
        <button
          ref={button}
          type="button"
          onClick={more}
          disabled={pending}
          className={className}
        >
          {label}
        </button>
      )}
      {page?.rows
        .filter((row) => !drawn.has(row.id))
        .map((row) => (
          <Fragment key={row.id}>{row.node}</Fragment>
        ))}
    </>
  );
}
