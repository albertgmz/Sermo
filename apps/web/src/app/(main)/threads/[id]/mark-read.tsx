"use client";

import { useEffect } from "react";
import { markRead } from "@/app/(main)/threads/actions";

// Records that the member has read up to the last post of this page. A page cannot write while
// it renders, so this runs once the page is on screen and draws nothing.
export function MarkRead({
  threadId,
  position,
}: {
  threadId: number;
  position: number;
}) {
  useEffect(() => {
    void markRead(threadId, position);
  }, [threadId, position]);
  return null;
}
