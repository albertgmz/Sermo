"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  Fragment,
  type ReactNode,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { usePolling } from "@/lib/polling";
import {
  dropForReload,
  EMPTY_TAIL,
  markTailShown,
  pollFound,
  pollFrom,
  readTail,
  type TailPoll,
  updateTail,
  useTail,
} from "@/lib/tail";

const PendingText = createContext("");

// The text of a message or reply that has been sent and not yet answered, inside the row the
// server drew for it (`LiveTail` gives each waiting text to its own copy of that row).
export function PendingBody() {
  const text = useContext(PendingText);
  return (
    <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
      {text}
    </p>
  );
}

const pendingId = (tailKey: string, id: number) => `${tailKey}-pending-${id}`;

// Whether the visitor is reading the end of the page: a row that arrives then keeps it in view.
const NEAR_END_PX = 240;
const nearEnd = () =>
  window.innerHeight + window.scrollY >=
  document.documentElement.scrollHeight - NEAR_END_PX;

// Where a conversation, or the last page of a thread, goes on after the rows the server drew: the
// rows that came since (see `lib/tail`) and the texts being sent. It is the last child of the list
// of rows, so a row is a `li` there (`as`) or the row itself. `drawn` is the newest row the server
// drew; a screen drawn again that holds rows of the tail takes them over, and they leave the tail.
export function LiveTail({
  tailKey,
  drawn,
  as,
  pendingRow,
  poll,
  intervalMs,
}: {
  tailKey: string;
  drawn: { id: number; mark: number };
  as?: "li";
  // The row the server drew for the visitor's own text, with a `PendingBody` where the text goes.
  pendingRow: ReactNode;
  // Asks the server for the rows after the newest one held (an action); polled every `intervalMs`
  // while the tab is visible.
  poll: (held: { id: number; mark: number }) => Promise<TailPoll>;
  intervalMs: number;
}) {
  const router = useRouter();
  const held = useTail(tailKey) ?? EMPTY_TAIL;
  // A page drawn newer than a row has the row: it is not shown twice while the effect below takes
  // it out.
  const tail = {
    ...held,
    rows: held.rows.filter((row) => row.mark > drawn.mark),
  };
  const Row = as ?? Fragment;
  const atEnd = useRef(false);

  useEffect(() => markTailShown(tailKey), [tailKey]);

  useEffect(() => {
    updateTail(tailKey, (now) =>
      now.rows.some((row) => row.mark <= drawn.mark)
        ? {
            ...now,
            rows: now.rows.filter((row) => row.mark > drawn.mark),
          }
        : now,
    );
  }, [tailKey, drawn.mark]);

  useEffect(() => {
    const note = () => {
      atEnd.current = nearEnd();
    };
    note();
    window.addEventListener("scroll", note, { passive: true });
    window.addEventListener("resize", note, { passive: true });
    return () => {
      window.removeEventListener("scroll", note);
      window.removeEventListener("resize", note);
    };
  }, []);

  usePolling(
    async () => {
      const answer = await poll(
        pollFrom(readTail(tailKey) ?? EMPTY_TAIL, drawn),
      );
      if ("stop" in answer) return "stop";
      // The thread changed under the page (a merge moved posts): draw it again.
      if ("reload" in answer) {
        updateTail(tailKey, dropForReload);
        return router.refresh();
      }
      if (answer.rows.length > 0) {
        updateTail(tailKey, (now) => pollFound(now, answer.rows));
      }
    },
    { intervalMs },
  );

  // The element that is the end of the list now: the newest text being sent, else the newest row.
  const lastPending = tail.pending.at(-1);
  const end = lastPending
    ? pendingId(tailKey, lastPending.id)
    : tail.rows.at(-1)?.key;
  useLayoutEffect(() => {
    if (end && atEnd.current) {
      document.getElementById(end)?.scrollIntoView({ block: "end" });
    }
  }, [end]);

  return (
    <>
      {tail.rows.map((row) => (
        // A row the server is still drawing waits on its own, not the whole list.
        <Row key={row.key}>
          <Suspense fallback={null}>{row.node}</Suspense>
        </Row>
      ))}
      {tail.pending.map(({ id, text }) => (
        <Row key={`pending-${id}`}>
          <div
            id={pendingId(tailKey, id)}
            aria-busy="true"
            className="opacity-60"
          >
            <PendingText value={text}>
              <Suspense fallback={null}>{pendingRow}</Suspense>
            </PendingText>
          </div>
        </Row>
      ))}
    </>
  );
}
