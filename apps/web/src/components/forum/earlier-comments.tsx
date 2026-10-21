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
  HOLD_GRACE_MS,
  HOLD_MAX_MS,
  HOLD_QUIET_MS,
} from "@/components/layout/spotlight";

// Older comments, drawn by the server one row each, oldest first; where the next press reads from
// (null: from the start), and whether none is left.
export type EarlierPage = {
  rows: { id: number; node: ReactNode }[];
  cursor: string | null;
  done: boolean;
};

// Whether a picture can still move the comments: one that is loading, or a lazy one on the screen
// (a lazy one away from it is not loaded at all, and is not waited for).
function stillLoading(image: HTMLImageElement) {
  if (image.complete) return false;
  if (image.loading !== "lazy") return true;
  const box = image.getBoundingClientRect();
  return box.bottom > 0 && box.top < window.innerHeight;
}

// The rows of both, each comment once and oldest first; a row of `later` replaces its older copy.
export const merged = (held: EarlierPage["rows"], later: EarlierPage["rows"]) =>
  [...new Map([...held, ...later].map((row) => [row.id, row])).values()].sort(
    (a, b) => a.id - b.id,
  );

// The comment the reader is looking at in the list (the first one still on the screen), and
// where it is, to keep it there while rows go in above it. When the list is all above the screen
// the first comment is held; when its first comment still on the screen is below it, none is
// (the reader is not looking at the list, and holding one would drag the page for a redraw they
// did not ask for).
export function anchorIn(
  list: Element | null | undefined,
  viewport = window.innerHeight,
) {
  const rows = [...(list?.querySelectorAll('[id^="profile-comment-"]') ?? [])];
  const element =
    rows.find((row) => row.getBoundingClientRect().bottom > 0) ?? rows[0];
  if (!element) return null;
  const top = element.getBoundingClientRect().top;
  return top < viewport ? { element, top } : null;
}

// Work that runs one piece after the other, each once the one before is done, so each starts from
// what that left. A piece that fails changes nothing and does not stop the line.
export function workQueue() {
  let line = Promise.resolve();
  return (work: () => Promise<void>) => {
    const run = line.then(work).catch(() => {});
    line = run;
    return run;
  };
}

// "View previous comments…" above the comments of a wall post: each press reads the next page of
// older comments and inserts it above, where the list starts, and the page keeps still around what
// the reader was looking at: the comment they see stays where it was on the screen, also while the
// pictures of the batch load, until the reader acts (WebKit has no scroll anchoring of its own).
// Nothing is navigated to, so nothing scrolls or dims. The button goes once every comment is
// shown, and the keyboard's focus goes to the oldest comment.
//
// The page drawn again (a new comment, an edit, a deletion) gives a new `load`: the comments
// loaded are read again down to the oldest one, so they match it, with the reader's place held
// the same way; a row the server list now draws itself (`shown`) is never drawn twice. Presses
// and readings again run one after the other, each from what the one before left.
export function EarlierComments({
  load,
  shown,
  label,
  className,
}: {
  // `through` null: the page at `cursor`; else the comments from the start down to `through`.
  load: (cursor: string | null, through: number | null) => Promise<EarlierPage>;
  // The ids of the comments the server list draws.
  shown: number[];
  label: string;
  className?: string;
}) {
  const [page, setPage] = useState<EarlierPage | null>(null);
  const [pending, startTransition] = useTransition();
  const button = useRef<HTMLButtonElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  // The comment held while rows go in, and whether the keyboard's focus was on the button.
  const kept = useRef<{ element: Element; top: number; focus: boolean } | null>(
    null,
  );
  const holder = useRef<ReturnType<typeof createScrollHolder>>(null);
  // What is loaded, as the last answer left it; the newest `load`; the work in line.
  const current = useRef(page);
  const latest = useRef(load);
  latest.current = load;
  const queue = useRef(workQueue());
  useEffect(() => () => holder.current?.stop(), []);

  // The button stays for another try when a piece fails.
  const enqueue = (work: () => Promise<void>) => queue.current(work);
  const apply = (next: EarlierPage) => {
    const anchor = anchorIn(marker.current?.parentElement);
    kept.current = anchor && {
      ...anchor,
      focus: document.activeElement === button.current,
    };
    current.current = next;
    setPage(next);
  };

  // A new `load` is the list drawn again: what was loaded is read again.
  const first = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `enqueue` and `apply` read only refs; a new `load` is what it waits for
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void enqueue(async () => {
      const held = current.current;
      const oldest = held?.rows[0];
      if (!held || !oldest) return;
      apply(await latest.current(null, oldest.id));
    });
  }, [load]);

  // Runs once rows went in, before they are painted.
  useLayoutEffect(() => {
    const anchor = kept.current;
    kept.current = null;
    if (!anchor?.element.isConnected) return;
    const { element, top } = anchor;
    const list = element.parentElement;
    if (anchor.focus && page?.done) {
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
      {
        quietMs: HOLD_QUIET_MS,
        maxMs: HOLD_MAX_MS,
        letGoOnScrollAfterMs: HOLD_GRACE_MS,
      },
    );
  }, [page]);

  const more = () =>
    startTransition(() =>
      enqueue(async () => {
        const held = current.current;
        // A redraw ahead of this press may have loaded every comment already.
        if (held?.done) return;
        const next = await latest.current(held?.cursor ?? null, null);
        apply({ ...next, rows: merged(held?.rows ?? [], next.rows) });
      }),
    );

  const drawn = new Set(shown);
  return (
    <>
      <span ref={marker} hidden />
      {!page?.done && (
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
