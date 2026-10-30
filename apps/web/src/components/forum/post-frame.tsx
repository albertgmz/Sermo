import type { Hourglass } from "lucide-react";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { HiddenWhileEditing } from "@/components/forum/in-place-edit";
import { POSTBIT_FRAME, Postbit } from "@/components/forum/postbit";
import { RelativeTime } from "@/components/forum/relative-time";
import { SignatureHtml } from "@/components/forum/signature-html";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
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

// The header row of a post: the time, `after` it (the edited mark, or the author's name on a folded
// post) and `trailing` at its right, a dashed rule under it, as XenForo's message attribution. A
// plain function, so its markup stays part of the frame's own.
function postHeader({
  createdAt,
  after,
  trailing,
}: {
  createdAt: string;
  after?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    // The rule spans the column exactly; only the row inside reaches into the padding on a phone,
    // so the 40 px controls at its right line up with the card's edge.
    <div className="mb-2 border-b border-dashed pb-0.5 md:mb-3 md:pb-1.5">
      <div className="-mr-2.5 flex items-center justify-between gap-2 text-xs text-muted-foreground md:mr-0">
        {/* The time is never cut short: what follows it gives way instead. */}
        <div className="flex min-w-0 items-center gap-2">
          <RelativeTime date={createdAt} className="shrink-0" />
          {after && <span className="min-w-0 truncate">{after}</span>}
        </div>
        {trailing && (
          <div className="flex shrink-0 items-center">{trailing}</div>
        )}
      </div>
    </div>
  );
}

// The frame of a post in a thread or a message in a conversation: the author on the left (above
// the text on a phone), then the header row (`postHeader`), the content, the signature and the
// actions (pushed to the bottom of the cell). What differs is passed in. While the post is edited
// in place the editor is its content, and the signature and the actions step aside.
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
        {postHeader({ createdAt, after: edited, trailing })}

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

// A deleted post or message folded to one line inside a `DeletedItem`, as XenForo draws one: the
// author's small avatar where the postbit stands (before the header on a phone), the header row
// with the time and the author's name, and the deletion notice (`notice`) under it.
export function FoldedPostFrame({
  id,
  author,
  createdAt,
  trailing,
  notice,
}: {
  id: string;
  author: AuthorView;
  createdAt: string;
  trailing?: React.ReactNode;
  notice: React.ReactNode;
}) {
  return (
    <article
      id={id}
      data-shortcut-item=""
      className={cn(
        "grid scroll-mt-landing-gap grid-cols-[auto_minmax(0,1fr)] gap-x-2 p-3 md:gap-x-4 md:p-4",
        POSTBIT_FRAME.grid,
      )}
      style={POSTBIT_FRAME.style}
    >
      <UserAvatar
        user={author.member}
        size="sm-lg"
        className="md:row-span-2 md:justify-self-center"
      />
      {postHeader({
        createdAt,
        after: <UserLink user={author.member} />,
        trailing,
      })}
      <div className="col-span-2 min-w-0 md:col-span-1 md:col-start-2">
        {notice}
      </div>
    </article>
  );
}
