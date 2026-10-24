"use client";

import { type LucideIcon, Reply } from "lucide-react";
import { useSubmitTitle } from "@/components/forum/composer-submit";
import { PendingButton } from "@/components/forum/pending-button";
import { cn } from "@/lib/utils";

// The end of every composer, as XenForo draws it under its editor: the chosen files, then a
// labelled submit with an icon in a soft tint of the accent, edged by a faint line of it, and the
// labelled "Attach files"
// button (`files`, an `AttachmentField` in its `compact` form, whose button goes last in the row).
// A reply or a new post has "Attach files" at the start and the submit at the end of the row; a
// comment has the submit first and "Attach files" after it, on a line of its own where the row is
// too narrow. Both have XenForo's size everywhere: 44 px tall, 20 px of padding, a 9 px radius and
// 13 px text (the submit's tint and edge are 10 % of the accent). The
// icon says what the submit does, as XenForo's: the reply arrow (a reply, a post, a comment)
// unless the composer names another (a pen for a new thread, a conversation for a direct message).
// The submit's look, shared with an edit page's save (`FormFooter`).
export const submitClass =
  "h-11 gap-2 rounded-[9px] border border-primary/10 bg-primary/10 px-5 text-(length:--text-compact) text-primary-ink hover:bg-primary/15";

export function ComposerButtons({
  submitLabel,
  icon: Icon = Reply,
  order,
  disabled,
  files,
  className,
}: {
  submitLabel: string;
  icon?: LucideIcon;
  order: "reply" | "comment";
  // While a file is on its way, or until what the post needs is written.
  disabled?: boolean;
  files?: React.ReactNode;
  className?: string;
}) {
  const title = useSubmitTitle(submitLabel);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {files}
      <PendingButton
        disabled={disabled}
        title={title}
        className={cn(
          submitClass,
          // The files' Attach button is `order-last` too (`AttachmentField`): with the same
          // order the page's order decides, so the submit follows it at the end of the row. A
          // comment's submit keeps the default order and comes before it.
          order === "reply" && "order-last ml-auto",
        )}
      >
        <Icon aria-hidden="true" />
        {submitLabel}
      </PendingButton>
    </div>
  );
}
