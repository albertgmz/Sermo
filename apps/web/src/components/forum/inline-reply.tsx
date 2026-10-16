"use client";

import { MessageSquareReply } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import type { LineComposerState } from "@/components/forum/line-composer";
import {
  actionLabelClass,
  messageActionClass,
} from "@/components/forum/message-action";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The composer's code comes when the box is first opened, so a card does not carry it, and a feed
// of twenty cards carries it once, if at all.
const LazyLineComposer = dynamic(
  () =>
    import("@/components/forum/line-composer").then(
      (module) => module.LineComposer,
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-10 w-full rounded-4xl" />,
  },
);

// A card's Reply button and the box it opens: a full row of its own (`basis-full`), so the card
// must hold it among its actions in a wrapping row. Nothing of the box is drawn, or loaded, before
// the button is pressed.
export function InlineReply({
  action,
  label,
  placeholder,
  submitLabel,
  anchor,
}: {
  action: (
    previous: LineComposerState,
    formData: FormData,
  ) => Promise<LineComposerState>;
  // The button's name; the card says it, so the browser is not sent the card's texts.
  label: string;
  placeholder: string;
  submitLabel: string;
  // The id of the box, for a link that leads to it.
  anchor: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? anchor : undefined}
        onClick={() => setOpen((was) => !was)}
        className={cn(messageActionClass, "aria-expanded:bg-muted")}
      >
        <MessageSquareReply aria-hidden="true" />
        <span className={actionLabelClass}>{label}</span>
      </button>
      {open && (
        <div
          id={anchor}
          className="order-last basis-full scroll-mt-24 px-2 pt-1 pb-1"
        >
          <LazyLineComposer
            action={action}
            placeholder={placeholder}
            submitLabel={submitLabel}
          />
        </div>
      )}
    </>
  );
}
