"use client";

import type { ThreadHeadingValue } from "@/app/[locale]/(main)/threads/edit-in-place";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { setItemState, useItemState } from "@/lib/item-state";
import type { PrefixView } from "@/lib/sermo/views";

const headingKey = (threadId: number) => `thread-heading:${threadId}`;

// The thread's prefix and title in its heading, as the server drew them or as an edit made on the
// page (the thread's editor, the opening post's) saved them since, and its +18 mark after them.
// `adultBadge` is the mark as the server draws it, given while the site's +18 mode is on; `adult`
// says whether the thread carries it (its own mark or its forum's).
export function ThreadHeading(props: {
  threadId: number;
  title: string;
  prefix: PrefixView | null;
  adult: boolean;
  adultBadge?: React.ReactNode;
}) {
  const shown =
    useItemState<ThreadHeadingValue | null>(
      headingKey(props.threadId),
      null,
      props,
    ) ?? props;
  return (
    <>
      {shown.prefix && (
        <PrefixTag prefix={shown.prefix} className="mr-2 align-[0.1875rem]" />
      )}
      {shown.title}
      {shown.adult && props.adultBadge}
    </>
  );
}

// Shows a saved title and prefix in the heading, and the title in the tab's.
export function showThreadHeading(
  threadId: number,
  was: string,
  saved: ThreadHeadingValue,
) {
  setItemState(headingKey(threadId), null, saved);
  if (was && document.title.includes(was)) {
    document.title = document.title.replace(was, () => saved.title);
  }
}
