import type { profilePostsList } from "@sermo/core/contracts";
import { Hourglass } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type * as z from "zod";
import { PostAttachments } from "@/app/[locale]/(main)/threads/[id]/post-attachments";
import { DeletedItem } from "@/components/forum/deleted-item";
import {
  type Deletion,
  DeletionNotice,
} from "@/components/forum/deletion-notice";
import {
  EarlierComments,
  type EarlierPage,
} from "@/components/forum/earlier-comments";
import { HtmlContent } from "@/components/forum/html-content";
import {
  LineComposer,
  type LineComposerState,
} from "@/components/forum/line-composer";
import { PostNote } from "@/components/forum/post-frame";
import type { ReactionType } from "@/components/forum/reaction-button";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { WallItemActions } from "@/components/forum/wall-item-actions";
import { inlineAttachmentIds } from "@/lib/attachment-tags";
import type { getReactionTypes } from "@/lib/sermo/reactions";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

type ApiWallPost = z.output<typeof profilePostsList.output>["items"][number];
export type ApiWallComment = ApiWallPost["latestComments"][number];

// A row of the block under a wall post, as XenForo's `message-responseRow`: each has its own
// border, drawn over its neighbour's so the rows share one line, on the quieter alternate ground.
const rowClass = "-mt-px border bg-muted/60 px-2";

// A row that is one link or button: the older comments, back to the newest ones.
const linkRowClass = cn(
  rowClass,
  "flex min-h-10 w-full items-center text-left font-medium underline-offset-4 hover:underline md:min-h-8",
);

// Says that a wall post or a comment is waiting for approval; a deleted one carries its deletion
// notice instead (`WallDeletionNotice`).
export function WallStateNote({ state }: { state: ApiWallPost["state"] }) {
  const t = useTranslations("forum.wallComments");
  if (state !== "moderated") return null;
  return (
    <PostNote icon={Hourglass} className="mt-0 mb-1">
      {t("awaitingApproval")}
    </PostNote>
  );
}

// The deletion notice of a deleted wall post or comment, holding its restore and delete (`tools`).
export function WallDeletionNotice({
  deletion,
  tools,
  className,
}: {
  deletion: Deletion | null;
  tools: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations("forum.wallComments");
  return (
    <DeletionNotice
      deletion={deletion}
      fallback={t("deleted")}
      tools={tools}
      className={className}
    />
  );
}

// Whether a wall post has a block of comments to draw under it.
export function hasWallComments(
  post: Pick<ApiWallPost, "canComment">,
  comments: ApiWallComment[],
  earlier?: EarlierLoad,
) {
  return comments.length > 0 || post.canComment || earlier !== undefined;
}

// Loads the comments before those a list shows (see `EarlierComments`).
export type EarlierLoad = {
  load: (cursor: string | null, through: number | null) => Promise<EarlierPage>;
};

type RowProps = {
  // The wall the post is on, for the comments' permalinks.
  profileUserId: number;
  member: (id: number) => MemberView;
  viewerId: number | null;
  // What the picker offers; none when the viewer may not react.
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
  viewList?: boolean;
  // Bringing back a deleted comment (`profilePost.undelete`).
  mayUndelete?: boolean;
};

// Comments in the order they were written, oldest first.
export const oldestFirst = (comments: ApiWallComment[]) =>
  [...comments].sort((a, b) => a.id - b.id);

// The rows of comments, oldest first: those a list is drawn with, and each batch of older ones
// loaded into it. A comment is drawn as XenForo draws one: a small avatar, then the author's name,
// the text and one quiet footer (date, report, "•••" | react), who reacted under it. A deleted one
// folds to the name and its deletion notice (`DeletedItem`).
export function WallCommentRows({
  comments,
  profileUserId,
  member,
  viewerId,
  picker,
  reactionTypes,
  viewList,
  mayUndelete,
}: RowProps & { comments: ApiWallComment[] }) {
  return oldestFirst(comments).map((comment) => {
    const author = member(comment.author.id);
    const actions = {
      kind: "comment" as const,
      item: comment,
      address: { profileUserId, postId: comment.profilePostId },
      viewerId,
      picker,
      reactionTypes,
      viewList,
      mayUndelete,
    };
    const folded = comment.state === "deleted";
    const notice = folded && (
      <WallDeletionNotice
        deletion={comment.deletion}
        tools={<WallItemActions {...actions} part="tools" />}
        className="mt-0 mb-1"
      />
    );
    const row = (content: React.ReactNode, className?: string) => (
      <article
        key={comment.id}
        id={`profile-comment-${comment.id}`}
        className={cn(
          rowClass,
          "flex scroll-mt-landing-gap gap-3 pt-2",
          className,
        )}
      >
        <UserAvatar
          user={author}
          size="sm"
          className="relative after:absolute after:-inset-2"
        />
        <div className="min-w-0 flex-1">
          <p className="leading-6 font-semibold [overflow-wrap:anywhere]">
            <UserLink user={author} />
          </p>
          {content}
        </div>
      </article>
    );
    const full = row(
      <>
        {notice || <WallStateNote state={comment.state} />}
        <HtmlContent
          className="text-(length:--text-compact)"
          content={{ type: "profile_post_comment", id: comment.id }}
          attachments={comment.attachments}
        >
          {comment.bodyHtml}
        </HtmlContent>
        <PostAttachments
          attachments={comment.attachments}
          inline={inlineAttachmentIds(comment.bodyHtml, comment.attachments)}
        />
        <WallItemActions {...actions} part={folded ? "footer" : undefined} />
      </>,
    );
    if (!folded) return full;
    return (
      <DeletedItem key={comment.id} collapsed={row(notice, "pb-1")}>
        {full}
      </DeletedItem>
    );
  });
}

// The block under a wall post, wherever one is drawn (the profile wall, the feed), in XenForo's
// order: who reacted to the post (a row only once someone did), the button that loads the older
// comments above in place (`earlier`), the comments oldest first, then the viewer's composer for
// the next one, at `#<anchor>-comment`, with the viewer's avatar beside it from `md` up.
export function WallComments({
  anchor,
  comments,
  earlier,
  summary,
  links = {},
  action,
  className,
  ...rows
}: RowProps & {
  // The id of the post's element on the page.
  anchor: string;
  // The newest few, or one page of them where the post is open.
  comments: ApiWallComment[];
  // Loads the older comments, where there are any.
  earlier?: EarlierLoad;
  // Who reacted to the post (`WallItemSummary`); it draws nothing while nobody has.
  summary?: React.ReactNode;
  // Back to the newest few, where the post is open at an older page.
  links?: { fewer?: string };
  // Posts a comment; left out when the viewer may not comment.
  action?: (
    previous: LineComposerState,
    formData: FormData,
  ) => Promise<LineComposerState>;
  className?: string;
}) {
  const t = useTranslations("forum.wallComments");
  const { member, viewerId } = rows;
  return (
    <div className={cn("mt-2 pt-px text-(length:--text-compact)", className)}>
      {summary && (
        <div className={cn(rowClass, "flex py-0.5 empty:hidden")}>
          {summary}
        </div>
      )}
      {earlier && (
        <EarlierComments
          load={earlier.load}
          shown={comments.map((comment) => comment.id)}
          label={t("showMore")}
          className={cn(linkRowClass, "text-primary-ink")}
        />
      )}
      <WallCommentRows comments={comments} {...rows} />
      {links.fewer && (
        <Link
          href={links.fewer}
          className={cn(linkRowClass, "text-muted-foreground")}
        >
          {t("fewer")}
        </Link>
      )}
      {action && (
        <div
          id={`${anchor}-comment`}
          className={cn(rowClass, "flex scroll-mt-24 items-start gap-3 py-2")}
        >
          {/* Below `md` the editor takes the whole row, so its bar fits on one line on a phone. */}
          {viewerId !== null && (
            <UserAvatar
              user={member(viewerId)}
              size="sm"
              className="mt-2 hidden md:block"
            />
          )}
          <LineComposer
            action={action}
            placeholder={t("placeholder")}
            submitLabel={t("submit")}
            attach
            className="min-w-0 flex-1"
          />
        </div>
      )}
    </div>
  );
}
