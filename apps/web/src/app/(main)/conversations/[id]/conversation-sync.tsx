"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { markRead } from "@/app/(main)/conversations/actions";

// An address that names a message keeps the page at that message.
export const keepsPlace = (hash: string) => hash.startsWith("#message-");

// Sits under the newest message of the conversation: it scrolls there and records that the member
// has read the conversation, which also clears the alerts about it. That happens on every visit,
// not only when the conversation is unread: an alert can be unread while the conversation is not.
// A page cannot write while it renders, so this runs once the page is on screen and draws nothing
// but its anchor. The unread counts are drawn by the site's frame, which a soft navigation does
// not render again, so the route is refreshed once the answer is in.
export function ConversationSync({ id }: { id: number }) {
  const end = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    void markRead(id).then(() => {
      if (mounted) router.refresh();
    });
    return () => {
      mounted = false;
    };
  }, [id, router]);

  useEffect(() => {
    if (keepsPlace(window.location.hash)) return;
    end.current?.scrollIntoView({ block: "end" });
  }, []);

  return (
    <div
      ref={end}
      className="scroll-mb-(--spacing-mobile-nav) md:scroll-mb-0"
    />
  );
}
