"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { markRead } from "@/app/(main)/conversations/actions";

// Sits under the newest message of the conversation: it scrolls there and, when the member had
// not read it yet, records that they have. A page cannot write while it renders, so this runs once
// the page is on screen and draws nothing but its anchor. The unread counts are drawn by the
// layout, which a soft navigation does not render again, so the route is refreshed once the
// answer is in.
export function ConversationSync({
  id,
  unread,
}: {
  id: number;
  unread: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!unread) return;
    let mounted = true;
    void markRead(id).then(() => {
      if (mounted) router.refresh();
    });
    return () => {
      mounted = false;
    };
  }, [id, unread, router]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, []);

  return (
    <div
      ref={end}
      className="scroll-mb-[calc(7.5rem+env(safe-area-inset-bottom))] md:scroll-mb-16 lg:scroll-mb-0"
    />
  );
}
