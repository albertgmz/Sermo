"use client";

import { MessageSquareReply } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
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
// the button is pressed. Once opened, the box stays in place when it is closed again, hidden, so
// what was typed is not lost to a second press.
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
  const [opened, setOpened] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Opening puts the cursor in the field, as soon as the composer's code has drawn it.
  useEffect(() => {
    const host = box.current;
    if (!open || !host) return;
    const focusField = () => {
      const field = host.querySelector<HTMLElement>(
        "textarea, [contenteditable=true]",
      );
      field?.focus();
      return field !== null;
    };
    if (focusField()) return;
    const observer = new MutationObserver(() => {
      if (focusField()) observer.disconnect();
    });
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={opened ? anchor : undefined}
        onClick={() => {
          setOpened(true);
          setOpen((was) => !was);
        }}
        className={cn(messageActionClass, "aria-expanded:bg-muted")}
      >
        <MessageSquareReply aria-hidden="true" />
        <span className={actionLabelClass}>{label}</span>
      </button>
      {opened && (
        <div
          ref={box}
          id={anchor}
          hidden={!open}
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
