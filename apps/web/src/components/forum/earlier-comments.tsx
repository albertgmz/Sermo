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

// One batch of older comments, drawn by the server, and where the next batch starts (null when
// none is left).
export type EarlierPage = { rows: ReactNode; nextCursor: string | null };

// "Show more comments" under a wall post: each press loads the batch before the oldest comment
// shown and inserts it above, where the list starts, and the page keeps still around what the
// reader was looking at: the comment that was first stays where it was on the screen, also while
// the pictures of the batch load, until the reader scrolls (WebKit has no scroll anchoring of its
// own). Nothing is navigated to, so nothing scrolls or dims. The button goes once every comment
// is shown.
export function EarlierComments({
  load,
  from,
  label,
  className,
}: {
  load: (cursor: string | null) => Promise<EarlierPage>;
  // Where the first batch starts: null for the newest comments, from which those already shown
  // are left out by `load`.
  from: string | null;
  label: string;
  className?: string;
}) {
  const [batches, setBatches] = useState<ReactNode[]>([]);
  const [cursor, setCursor] = useState(from);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const button = useRef<HTMLButtonElement>(null);
  // The comment that was first before a batch went in, and where it was on the screen.
  const kept = useRef<{ element: Element; top: number } | null>(null);
  const holder = useRef<ReturnType<typeof createScrollHolder>>(null);
  useEffect(() => () => holder.current?.stop(), []);

  // Runs once a batch is in, before it is painted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new batch is what it waits for
  useLayoutEffect(() => {
    const anchor = kept.current;
    kept.current = null;
    if (!anchor?.element.isConnected) return;
    const { element, top } = anchor;
    const list = element.parentElement;
    holder.current?.stop();
    holder.current = createScrollHolder({
      ...holdEnv,
      // Settled once the pictures of the list are in.
      loaded: () =>
        [...(list?.querySelectorAll("img") ?? [])].every(
          (image) => image.complete,
        ),
    });
    holder.current.hold(
      () => window.scrollY + element.getBoundingClientRect().top - top,
      { quietMs: HOLD_QUIET_MS, maxMs: HOLD_MAX_MS },
    );
  }, [batches]);

  const more = () =>
    startTransition(async () => {
      let page: EarlierPage;
      try {
        page = await load(cursor);
      } catch {
        // The button stays for another try.
        return;
      }
      const first = button.current?.parentElement?.querySelector(
        '[id^="profile-comment-"]',
      );
      kept.current = first
        ? { element: first, top: first.getBoundingClientRect().top }
        : null;
      setBatches((shown) => [page.rows, ...shown]);
      setCursor(page.nextCursor);
      setDone(page.nextCursor === null);
    });

  return (
    <>
      {!done && (
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
      {batches.map((rows, index) => (
        // Each batch keeps its key as older ones go in before it.
        // biome-ignore lint/suspicious/noArrayIndexKey: counted from the newest batch, which never moves
        <Fragment key={batches.length - index}>{rows}</Fragment>
      ))}
    </>
  );
}
