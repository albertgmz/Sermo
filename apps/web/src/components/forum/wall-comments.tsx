import type { profilePostsList } from "@sermo/core/contracts";
import { Hourglass, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type * as z from "zod";
import { PostAttachments } from "@/app/[locale]/(main)/threads/[id]/post-attachments";
import {
  EarlierComments,
  type EarlierPage,
} from "@/components/forum/earlier-comments";
import { EditedMark } from "@/components/forum/edited-mark";
import { HtmlContent } from "@/components/forum/html-content";
import {
  LineComposer,
  type LineComposerState,
} from "@/components/forum/line-composer";
import { MessageRow } from "@/components/forum/message-row";
import { PostNote } from "@/components/forum/post-frame";
import type { ReactionType } from "@/components/forum/reaction-button";
import { RelativeTime } from "@/components/forum/relative-time";
import { WallItemActions } from "@/components/forum/wall-item-actions";
import { inlineAttachmentIds } from "@/lib/attachment-tags";
import type { getReactionTypes } from "@/lib/sermo/reactions";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

type ApiWallPost = z.output<typeof profilePostsList.output>["items"][number];
export type ApiWallComment = ApiWallPost["latestComments"][number];

const textLinkClass =
  "inline-flex h-10 items-center text-sm font-medium underline-offset-4 hover:underline md:h-8";

// Says that a wall post or a comment is not visible to everyone; nothing for a visible one.
export function WallStateNote({ state }: { state: ApiWallPost["state"] }) {
  const t = useTranslations("forum.wallComments");
  if (state === "visible") return null;
  const Icon = state === "moderated" ? Hourglass : Trash2;
  return (
    <PostNote icon={Icon} className="mt-0 mb-1">
      {t(state === "moderated" ? "awaitingApproval" : "deleted")}
    </PostNote>
  );
}

// Whether a wall post has anything to draw under it.
export function hasWallComments(
  post: Pick<ApiWallPost, "canComment">,
  comments: ApiWallComment[],
  earlier?: EarlierLoad,
) {
  return comments.length > 0 || post.canComment || earlier !== undefined;
}

// Loads the comments before those a list shows (see `EarlierComments`).
export type EarlierLoad = {
  load: (through: number | null) => Promise<EarlierPage>;
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
};

// Comments in the order they were written, oldest first.
export const oldestFirst = (comments: ApiWallComment[]) =>
  [...comments].sort((a, b) => a.id - b.id);

// The rows of comments, oldest first: those a list is drawn with, and each batch of older ones
// loaded into it.
export function WallCommentRows({
  comments,
  profileUserId,
  member,
  viewerId,
  picker,
  reactionTypes,
  viewList,
}: RowProps & { comments: ApiWallComment[] }) {
  return oldestFirst(comments).map((comment) => (
    <MessageRow
      key={comment.id}
      id={`profile-comment-${comment.id}`}
      compact
      author={member(comment.author.id)}
      time={
        <>
          <RelativeTime date={comment.createdAt} />
          {comment.editedAt && (
            <EditedMark date={comment.editedAt} className="ml-1.5" />
          )}
        </>
      }
      actions={
        <WallItemActions
          kind="comment"
          item={comment}
          address={{ profileUserId, postId: comment.profilePostId }}
          viewerId={viewerId}
          picker={picker}
          reactionTypes={reactionTypes}
          viewList={viewList}
        />
      }
    >
      <WallStateNote state={comment.state} />
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
    </MessageRow>
  ));
}

// The comments under a wall post and the one-line composer for a new one, wherever a wall post
// is drawn: the profile wall and the feed. Older comments load above in place (`earlier`). The
// composer sits at `#<anchor>-comment`.
export function WallComments({
  anchor,
  comments,
  earlier,
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
  return (
    <div className={cn("mt-2 space-y-3 border-l pl-3", className)}>
      {earlier && (
        <EarlierComments
          load={earlier.load}
          shown={comments.map((comment) => comment.id)}
          label={t("showMore")}
          className={cn(textLinkClass, "text-primary-ink")}
        />
      )}
      <WallCommentRows comments={comments} {...rows} />
      {links.fewer && (
        <Link
          href={links.fewer}
          className={cn(textLinkClass, "ml-4 text-muted-foreground")}
        >
          {t("fewer")}
        </Link>
      )}
      {action && (
        <div id={`${anchor}-comment`} className="scroll-mt-24">
          <LineComposer
            action={action}
            placeholder={t("placeholder")}
            submitLabel={t("submit")}
            attach
          />
        </div>
      )}
    </div>
  );
}
