"use client";

import { type LucideIcon, Reply } from "lucide-react";
import { useSubmitTitle } from "@/components/forum/composer-submit";
import { PendingButton } from "@/components/forum/pending-button";
import { cn } from "@/lib/utils";

// The end of every composer, as XenForo draws it under its editor: the chosen files, then a
// labelled submit with an icon on the accent, and the labelled "Attach files"
// button (`files`, an `AttachmentField` in its `compact` form, whose button goes last in the row).
// A reply or a new post has "Attach files" at the start and the submit at the end of the row; a
// comment has the submit first and "Attach files" after it, on a line of its own where the row is
// too narrow. Both have XenForo's size everywhere: 44 px tall, 20 px of padding, a 9 px radius and
// 13 px text. The
// icon says what the submit does, as XenForo's: the reply arrow (a reply, a post, a comment)
// unless the composer names another (a pen for a new thread, a conversation for a direct message).
// The submit's look, shared with an edit page's save (`FormFooter`): the solid accent button, the
// most prominent one of the row, which a waiting one (the button's own `disabled:opacity-50`) is
// plainly not.
export const submitClass =
  "h-11 gap-2 rounded-[9px] bg-primary px-5 text-(length:--text-compact) text-primary-foreground hover:bg-primary/90";

// The look of the row's other buttons ("Attach files", "Preview") over `buttonVariants` outline:
// XenForo's, the card's fill edged by the border colour, the size of the submit.
export const rowButtonClass =
  "h-11 gap-2 rounded-[9px] border-border bg-card px-5 text-(length:--text-compact) dark:border-border dark:bg-card";

export function ComposerButtons({
  submitLabel,
  icon: Icon = Reply,
  order,
  disabled,
  files,
  beforeSubmit,
  className,
}: {
  submitLabel: string;
  icon?: LucideIcon;
  order: "reply" | "comment";
  // While a file is on its way, or until what the post needs is written.
  disabled?: boolean;
  files?: React.ReactNode;
  // A button of the composer's own, just before the submit (a new thread's Preview); below `sm`
  // the submit then has a line of its own.
  beforeSubmit?: React.ReactNode;
  className?: string;
}) {
  const title = useSubmitTitle(submitLabel);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {files}
      {beforeSubmit && (
        <span className={cn(order === "reply" && "order-last ml-auto")}>
          {beforeSubmit}
        </span>
      )}
      <PendingButton
        disabled={disabled}
        title={title}
        className={cn(
          submitClass,
          // The files' Attach button is `order-last` too (`AttachmentField`): with the same
          // order the page's order decides, so the submit follows it at the end of the row. A
          // comment's submit keeps the default order and comes before it.
          order === "reply" && "order-last",
          order === "reply" && !beforeSubmit && "ml-auto",
          // With a button of the composer's own beside it, a phone's row has no room for the
          // three: the submit takes a line of its own, full width, as XenForo's stays prominent.
          beforeSubmit && "max-sm:basis-full",
        )}
      >
        <Icon aria-hidden="true" />
        {submitLabel}
      </PendingButton>
    </div>
  );
}
