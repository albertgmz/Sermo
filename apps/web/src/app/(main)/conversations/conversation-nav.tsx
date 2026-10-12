"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "@/lib/utils";

export function ListPane({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment();
  return (
    <aside
      className={cn(
        "min-w-0 flex-col lg:flex lg:w-[340px] lg:shrink-0 lg:border-r",
        segment ? "hidden" : "flex",
      )}
    >
      {children}
    </aside>
  );
}

export function ConversationLink({
  id,
  children,
}: {
  id: number;
  children: React.ReactNode;
}) {
  const segment = useSelectedLayoutSegment();
  return (
    <div
      aria-current={segment === String(id) ? "page" : undefined}
      className="relative flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 aria-[current=page]:bg-muted"
    >
      {children}
    </div>
  );
}
