import type { Hourglass } from "lucide-react";
import { useLocale } from "next-intl";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { HiddenWhileEditing } from "@/components/forum/in-place-edit";
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
// the text on a phone), then the header row (the time, `trailing` at its right, a dashed rule
// under it, as XenForo's message attribution), the content, the signature and the actions (pushed to the bottom of the cell). What
// differs is passed in. While the post is edited in place the editor is its content, and the
// signature and the actions step aside.
export function PostFrame({
  id,
  author,
  createdAt,
  highlighted = false,
  edited,
  trailing,
  actions,
  signed = false,
  children,
}: {
  // None for the row drawn for a text that is being sent (there can be several).
  id?: string;
  author: AuthorView;
  createdAt: string;
  // The cover draws over the whole frame instead of its top.
  highlighted?: boolean;
  // Next to the time: when it was edited.
  edited?: React.ReactNode;
  // At the right of the time row.
  trailing?: React.ReactNode;
  // The footer that closes the frame: a `ContentActions`, which parts itself from the body.
  actions: React.ReactNode;
  // Whether the author's signature follows the content, above the footer.
  signed?: boolean;
  // Under the time row: notes, the body and its attachments.
  children: React.ReactNode;
}) {
  const locale = useLocale();
  return (
    <article
      id={id}
      data-shortcut-item=""
      className={cn(
        "relative isolate grid scroll-mt-landing-gap grid-cols-1 p-3 md:gap-x-4 md:p-4",
        POSTBIT_FRAME.grid,
      )}
      style={POSTBIT_FRAME.style}
    >
      {/* A highlighted post adds the whole-frame picture to the postbit's own cover (behind the
          column, the header strip on a phone); on a phone that one alone is drawn. */}
      {highlighted && <CoverBackdrop cover={author.cover} variant="full" />}
      <Postbit
        author={author}
        coverClassName={highlighted ? "max-md:hidden" : undefined}
        className="max-md:mb-2 md:border-r md:pr-4"
      />

      <div className="flex min-w-0 flex-col">
        {/* The rule spans the column exactly; only the row inside reaches into the padding on a
            phone, so the 40 px controls at its right line up with the card's edge. */}
        <div className="mb-2 border-b border-dashed pb-0.5 md:mb-3 md:pb-1.5">
          <div className="-mr-2.5 flex items-center justify-between gap-2 text-xs text-muted-foreground md:mr-0">
            {/* The time is never cut short: the edited mark gives way instead. */}
            <div className="flex min-w-0 items-center gap-2">
              <RelativeTime date={createdAt} className="shrink-0 md:hidden" />
              <time dateTime={createdAt} className="hidden shrink-0 md:inline">
                {formatDateTime(createdAt, locale)}
              </time>
              {edited && <span className="min-w-0 truncate">{edited}</span>}
            </div>
            {trailing && (
              <div className="flex shrink-0 items-center">{trailing}</div>
            )}
          </div>
        </div>

        {children}

        {signed && author.signatureHtml && (
          <HiddenWhileEditing>
            <SignatureHtml className="mt-3 border-t pt-2">
              {author.signatureHtml}
            </SignatureHtml>
          </HiddenWhileEditing>
        )}

        {/* As XenForo's message footer: at the bottom of the cell, level with the bottom of the
            author column, however short the text. */}
        <div className="mt-auto">{actions}</div>
      </div>
    </article>
  );
}
