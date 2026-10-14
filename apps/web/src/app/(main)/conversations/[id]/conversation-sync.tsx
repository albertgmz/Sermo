"use client";

import { useRouter } from "next/navigation";
import { useContext, useEffect, useRef } from "react";
import { MarkReadContext } from "@/app/(main)/conversations/[id]/mark-read-state";
import { markRead } from "@/app/(main)/conversations/actions";

// An address that names a message keeps the page at that message.
export const keepsPlace = (hash: string) => hash.startsWith("#message-");

// Sits under the messages of the conversation. When the member has something to clear (the
// conversation is unread, or they have unread alerts, one of which may be about it) it records
// that they have read the conversation, which also clears the alerts about it; otherwise it
// writes nothing. On the newest page it also scrolls to the end. A page cannot write while it
// renders, so this runs once the page is on screen and draws nothing but its anchor. The unread
// counts are drawn by the site's frame, which a soft navigation does not render again, so the
// route is refreshed once the answer is in. When the backend refuses, the page's "Mark as read"
// card is told (it is drawn only then).
export function ConversationSync({
  id,
  mark,
  scroll,
}: {
  id: number;
  mark: boolean;
  scroll: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { setFailed } = useContext(MarkReadContext);

  useEffect(() => {
    if (!mark) return;
    let mounted = true;
    setFailed(false);
    void markRead(id).then((marked) => {
      if (!mounted) return;
      if (marked) router.refresh();
      else setFailed(true);
    });
    return () => {
      mounted = false;
    };
  }, [id, mark, router, setFailed]);

  useEffect(() => {
    if (!scroll || keepsPlace(window.location.hash)) return;
    end.current?.scrollIntoView({ block: "end" });
  }, [scroll]);

  return (
    <div
      ref={end}
      className="scroll-mb-(--spacing-mobile-nav) md:scroll-mb-0"
    />
  );
}
