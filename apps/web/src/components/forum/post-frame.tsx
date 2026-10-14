import type { Hourglass } from "lucide-react";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { POSTBIT_FRAME, Postbit } from "@/components/forum/postbit";
import { RelativeTime } from "@/components/forum/relative-time";
import { SignatureHtml } from "@/components/forum/signature-html";
import { formatDateTime } from "@/lib/format";
import type { AuthorView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// A note under the time row: a post or message waiting for approval, or deleted.
export function PostNote({
  icon: Icon,
  children,
  className,
}: {
  icon: typeof Hourglass;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "mt-2 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </p>
  );
}

// The frame of a post in a thread or a message in a conversation: the author on the left (above
// the text on a phone), then the time, the content and the actions. What differs is passed in.
export function PostFrame({
  id,
  author,
  createdAt,
  highlighted = false,
  edited,
  trailing,
  actions,
  after,
  signed = false,
  children,
}: {
  id: string;
  author: AuthorView;
  createdAt: string;
  // The cover draws over the whole frame instead of its top.
  highlighted?: boolean;
  // Next to the time: when it was edited.
  edited?: React.ReactNode;
  // At the right of the time row.
  trailing?: React.ReactNode;
  // The row of actions under the content.
  actions: React.ReactNode;
  // Under the actions row.
  after?: React.ReactNode;
  // Whether the author's signature closes the frame.
  signed?: boolean;
  // Under the time row: notes, the body and its attachments.
  children: React.ReactNode;
}) {
  return (
    <article
      id={id}
      className={cn(
        "relative isolate grid scroll-mt-4 grid-cols-1 p-3 md:gap-x-4 md:p-4",
        POSTBIT_FRAME.grid,
      )}
    >
      <CoverBackdrop
        cover={author.cover}
        variant={highlighted ? "full" : "header"}
        className={highlighted ? undefined : POSTBIT_FRAME.cover}
      />
      <Postbit author={author} className="max-md:mb-2 md:border-r md:pr-4" />

      <div className="min-w-0">
        <div className="-mr-2.5 flex items-center justify-between gap-2 text-xs text-muted-foreground md:mr-0">
          <div className="flex min-w-0 items-center gap-2">
            <RelativeTime date={createdAt} className="truncate md:hidden" />
            <time dateTime={createdAt} className="hidden truncate md:inline">
              {formatDateTime(createdAt)}
            </time>
            {edited}
          </div>
          {trailing && (
            <div className="flex shrink-0 items-center">{trailing}</div>
          )}
        </div>

        {children}

        <div className="mt-2 -mx-2 flex flex-wrap items-center justify-end gap-1">
          {actions}
        </div>

        {after}

        {signed && author.signatureHtml && (
          <SignatureHtml className="mt-2 border-t pt-2">
            {author.signatureHtml}
          </SignatureHtml>
        )}
      </div>
    </article>
  );
}
