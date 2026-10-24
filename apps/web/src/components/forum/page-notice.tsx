"use client";

import { Check } from "lucide-react";
import {
  type ComponentType,
  lazy,
  Suspense,
  useEffect,
  useSyncExternalStore,
} from "react";
import {
  announce,
  noticeText,
  saidNotice,
  subscribe,
} from "@/components/forum/notice-store";
import { cn } from "@/lib/utils";

// The line at the top of a page that says what the member just did on it (bought, wore, upgraded).
// A form whose action answered with a notice says so (`useAnnounce`), in place: the page is not
// opened again for it. The words go into a live region that is in the page all the time, so a
// screen reader hears them while focus stays where it was, and a card floats in view under the
// header, wherever the member is on the page, as XenForo's flash message does (`NoticeCard`; its
// code is fetched with the first notice, not with the page). It takes no room, so nothing moves
// when it goes. `drawn` is the notice the address names (`?notice=`, an older link), drawn as a
// plain line. `texts` holds the words of each notice the page knows; any other draws nothing.

// A card that cannot be fetched leaves the live region to say it.
export const cardOrNothing = (
  load: () => Promise<{ default: ComponentType<{ text: string }> }>,
) => load().catch(() => ({ default: (): null => null }));
const NoticeCard = lazy(() =>
  cardOrNothing(() => import("@/components/forum/notice-card")),
);

// The live region, written again for each notice said (a new element, so a repeat is read out).
export function NoticeStatus({
  text,
  seq,
}: {
  text: string | null;
  seq: number;
}) {
  return (
    <output aria-live="polite" className="sr-only">
      {text && <span key={seq}>{text}</span>}
    </output>
  );
}

// The words said and, once its code is there, the card: the live region speaks first.
export function NoticeView({
  text,
  seq,
}: {
  text: string | null;
  seq: number;
}) {
  return (
    <>
      <NoticeStatus text={text} seq={seq} />
      {text && (
        <Suspense fallback={null}>
          <NoticeCard text={text} />
        </Suspense>
      )}
    </>
  );
}

export function PageNotice({
  drawn,
  texts,
  className,
}: {
  drawn?: string;
  texts: Record<string, string>;
  className?: string;
}) {
  const now = useSyncExternalStore(subscribe, saidNotice, () => null);
  // A notice belongs to the page it was said on.
  useEffect(() => () => announce(null), []);
  const inline = noticeText(texts, drawn);
  const text = noticeText(texts, now?.notice);
  return (
    <>
      {inline && (
        <output
          className={cn(
            "flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-pretty",
            className,
          )}
        >
          <Check
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          {inline}
        </output>
      )}
      <NoticeView text={text} seq={now?.seq ?? 0} />
    </>
  );
}
