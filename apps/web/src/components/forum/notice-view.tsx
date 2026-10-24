"use client";

import { type ComponentType, lazy, Suspense } from "react";

// What a notice said in place draws (`PageNotice`, `ShareNotice`): the words in a live region that
// is in the page all the time, so a screen reader hears them while focus stays where it was, and a
// card floating under the header (`NoticeCard`), whose code is fetched with the first notice, not
// with the page. Kept apart from `PageNotice`, so the main layout's notice brings only this.

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
