import type { Hourglass } from "lucide-react";
import { AwardRow } from "@/components/forum/award-icon";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { levelWithBounds } from "@/components/forum/level";
import { RelativeTime } from "@/components/forum/relative-time";
import { SignatureHtml } from "@/components/forum/signature-html";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { UserStats } from "@/components/forum/user-stats";
import { formatDateTime } from "@/lib/format";
import type { AuthorView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// A note under the time row: a post or message waiting for approval, or deleted.
export function PostNote({
  icon: Icon,
  children,
}: {
  icon: typeof Hourglass;
  children: React.ReactNode;
}) {
  return (
    <p className="mt-2 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
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
  const { member } = author;

  return (
    <article
      id={id}
      className="relative isolate grid scroll-mt-4 grid-cols-[auto_minmax(0,1fr)] gap-x-3 p-3 md:gap-x-4 md:p-4"
    >
      <CoverBackdrop
        cover={author.cover}
        variant={highlighted ? "full" : "header"}
      />
      <UserAvatar user={member} size="lg" className="self-start md:hidden" />
      <UserAvatar
        user={member}
        size="xl"
        className="hidden self-start md:row-span-2 md:block"
      />
      <div className="flex min-w-0 flex-col justify-center gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <UserLink user={member} className="[overflow-wrap:anywhere]" />
          <UserBadges user={member} />
          <AwardRow awards={author.awards} />
        </div>
        <div className="flex items-center gap-x-3">
          {member.title && (
            <p
              title={member.title}
              className="min-w-0 truncate text-xs text-muted-foreground"
            >
              {member.title}
            </p>
          )}
          <UserStats
            user={{
              level: levelWithBounds(
                author.member.level,
                author.xp,
                author.currentLevelXp,
                author.nextLevelXp,
              ),
              postCount: author.postCount,
              reactionCount: author.reactionScore,
            }}
            className={cn(
              "shrink-0",
              // On a phone the XP bar gives its room to the title.
              member.title && "max-sm:[&_[data-slot=progress]]:hidden",
            )}
          />
        </div>
      </div>

      <div className="col-span-2 min-w-0 md:col-span-1 md:col-start-2">
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
