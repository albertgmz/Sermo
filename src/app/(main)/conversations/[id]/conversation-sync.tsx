"use client";

import { useEffect, useRef } from "react";
import { markRead } from "@/app/(main)/conversations/actions";

export function ConversationSync({
  id,
  unread,
}: {
  id: number;
  unread: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (unread) markRead(id);
  }, [id, unread]);

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
