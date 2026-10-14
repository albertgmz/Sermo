"use client";

import { ChevronDown } from "lucide-react";
import { useState, useTransition } from "react";
import { moreConversations } from "@/app/[locale]/(main)/conversations/more-conversations";
import { Button } from "@/components/ui/button";

// The rest of the list, a page at a time. The pages are asked for here, not through the URL,
// so the list's own page is told apart by the cursor it got.
export function LoadMore({ cursor, label }: { cursor: string; label: string }) {
  const [pages, setPages] = useState<React.ReactNode[]>([]);
  const [next, setNext] = useState<string | null>(cursor);
  const [pending, startTransition] = useTransition();
  return (
    <>
      {pages}
      {next && (
        <li className="p-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            className="h-10 w-full"
            onClick={() =>
              startTransition(async () => {
                const more = await moreConversations(next);
                setPages((shown) => [...shown, more.rows]);
                setNext(more.nextCursor);
              })
            }
          >
            <ChevronDown />
            {label}
          </Button>
        </li>
      )}
    </>
  );
}
