import { profileCommentsList, profilePostsList } from "@sermo/core/contracts";
import { Hourglass, MessageCircle, PenLine, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { react } from "@/app/(main)/actions";
import type { Profile } from "@/app/(main)/members/[id]/profile";
import { commentOnWallPost, postToWall } from "@/app/(main)/members/actions";
import { LoadMore } from "@/app/(main)/members/load-more";
import { WallComposer } from "@/app/(main)/members/wall-composer";
import { EmptyState } from "@/components/forum/empty-state";
import { HtmlContent } from "@/components/forum/html-content";
import { MessageRow, messageActionClass } from "@/components/forum/message-row";
import {
  ReactionButton,
  type ReactionType,
} from "@/components/forum/reaction-button";
import { ReactionSummary } from "@/components/forum/reaction-summary";
import { loadReactionUsers } from "@/components/forum/reaction-users-action";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { buttonVariants } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import {
  getReactionTypes,
  pickerTypes,
  reactionsView,
} from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

type ApiWallPost = z.output<typeof profilePostsList.output>["items"][number];
type ApiWallComment = ApiWallPost["latestComments"][number];
type ReactionTypes = Awaited<ReturnType<typeof getReactionTypes>>;

// One post whose comments are read in full, and where its page of them continues.
export type OpenComments = { postId: number; cursor?: string };

export function wallHref(
  profileId: number,
  params: { cursor?: string; comments?: OpenComments } = {},
) {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.comments) {
    query.set("comments", String(params.comments.postId));
    if (params.comments.cursor) {
      query.set("commentsCursor", params.comments.cursor);
    }
  }
  const text = query.toString();
  return `/members/${profileId}${text ? `?${text}` : ""}`;
}

const textLinkClass =
  "inline-flex h-10 items-center text-sm font-medium underline-offset-4 hover:underline md:h-8";

function StateNote({ state }: { state: ApiWallPost["state"] }) {
  const t = useTranslations("members.wall");
  if (state === "visible") return null;
  const Icon = state === "moderated" ? Hourglass : Trash2;
  return (
    <p className="mb-1 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {t(state === "moderated" ? "awaitingApproval" : "deleted")}
    </p>
  );
}

function Comment({
  comment,
  member,
  viewerId,
  picker,
  reactionTypes,
}: {
  comment: ApiWallComment;
  member: (id: number) => MemberView;
  viewerId: number | null;
  picker: ReactionType[];
  reactionTypes: ReactionTypes;
}) {
  return (
    <MessageRow
      id={`profile-comment-${comment.id}`}
      compact
      author={member(comment.author.id)}
      time={<RelativeTime date={comment.createdAt} />}
      actions={
        <>
          <ReactionButton
            action={react.bind(null, "profileComment", comment.id)}
            total={comment.reactions.total}
            viewerTypeId={comment.reactions.mine}
            types={comment.state === "visible" ? picker : []}
            viewerId={viewerId}
            authorId={comment.author.id}
            size="sm"
            className="-my-1.5 md:my-0"
          />
          <ReactionSummary
            reactions={reactionsView(comment.reactions, reactionTypes)}
            loadUsers={loadReactionUsers.bind(
              null,
              "profile_post_comment",
              comment.id,
            )}
            size="sm"
          />
        </>
      }
    >
      <StateNote state={comment.state} />
      <HtmlContent className="text-(length:--text-compact)">
        {comment.bodyHtml}
      </HtmlContent>
    </MessageRow>
  );
}

function WallPost({
  post,
  comments,
  links,
  member,
  viewerId,
  picker,
  reactionTypes,
  returnTo,
}: {
  post: ApiWallPost;
  // The newest few, or one page of them where the post is open.
  comments: ApiWallComment[];
  // Where the comments can be followed: more of them, older ones, or back to the newest few.
  links: { more?: string; older?: string; fewer?: string };
  member: (id: number) => MemberView;
  viewerId: number | null;
  picker: ReactionType[];
  reactionTypes: ReactionTypes;
  returnTo: string;
}) {
  const t = useTranslations("members.wall");
  const anchor = `profile-post-${post.id}`;
  const commentsHref = post.canComment
    ? `#${anchor}-comment`
    : viewerId === null
      ? `/login?next=${encodeURIComponent(returnTo)}`
      : null;
  const count = (
    <>
      <MessageCircle />
      {formatNumber(post.commentCount)}
    </>
  );
  const label = t("aria.comments", { count: post.commentCount });
  return (
    <MessageRow
      id={anchor}
      author={member(post.author.id)}
      time={<RelativeTime date={post.createdAt} />}
      actions={
        <>
          <ReactionButton
            action={react.bind(null, "profilePost", post.id)}
            total={post.reactions.total}
            viewerTypeId={post.reactions.mine}
            types={post.state === "visible" ? picker : []}
            viewerId={viewerId}
            authorId={post.author.id}
          />
          {commentsHref ? (
            <Link
              href={commentsHref}
              aria-label={label}
              className={messageActionClass}
            >
              {count}
            </Link>
          ) : (
            <span
              role="img"
              aria-label={label}
              className={cn(messageActionClass, "pointer-events-none")}
            >
              {count}
            </span>
          )}
          <ReactionSummary
            reactions={reactionsView(post.reactions, reactionTypes)}
            loadUsers={loadReactionUsers.bind(null, "profile_post", post.id)}
            className="ml-auto"
          />
        </>
      }
      footer={
        (comments.length > 0 || post.canComment || links.more) && (
          <div className="mt-2 space-y-3 border-l pl-3">
            {links.more && (
              <Link
                href={links.more}
                className={cn(textLinkClass, "text-primary")}
              >
                {t("showMoreComments")}
              </Link>
            )}
            {comments.map((comment) => (
              <Comment
                key={comment.id}
                comment={comment}
                member={member}
                viewerId={viewerId}
                picker={picker}
                reactionTypes={reactionTypes}
              />
            ))}
            {links.older && (
              <Link
                href={links.older}
                className={cn(textLinkClass, "text-primary")}
              >
                {t("olderComments")}
              </Link>
            )}
            {links.fewer && (
              <Link
                href={links.fewer}
                className={cn(textLinkClass, "ml-4 text-muted-foreground")}
              >
                {t("fewerComments")}
              </Link>
            )}
            {post.canComment && (
              <div id={`${anchor}-comment`} className="scroll-mt-24">
                <WallComposer
                  action={commentOnWallPost.bind(null, post.id, returnTo)}
                  placeholder={t("commentPlaceholder")}
                  submitLabel={t("commentSubmit")}
                />
              </div>
            )}
          </div>
        )
      }
    >
      <StateNote state={post.state} />
      <HtmlContent>{post.bodyHtml}</HtmlContent>
    </MessageRow>
  );
}

export async function Wall({
  profile,
  cursor,
  open,
}: {
  profile: Profile;
  cursor?: string;
  open?: OpenComments;
}) {
  const [{ items: posts, nextCursor }, reactionTypes, viewer, t] =
    await Promise.all([
      read(profilePostsList, { userId: profile.id, cursor }),
      getReactionTypes(),
      getViewer(),
      getTranslations("members.wall"),
    ]);
  const openPost = open && posts.find((post) => post.id === open.postId);
  const openPage = openPost
    ? await read(profileCommentsList, {
        profilePostId: openPost.id,
        cursor: open?.cursor,
      })
    : null;
  const member = await membersFor([
    ...posts.flatMap((post) => [
      post.author,
      ...post.latestComments.map((comment) => comment.author),
    ]),
    ...(openPage?.items.map((comment) => comment.author) ?? []),
    ...(viewer.user ? [viewer.user] : []),
  ]);
  const viewerId = viewer.user?.id ?? null;
  const picker = viewer.permissions.canReact ? pickerTypes(reactionTypes) : [];
  const returnTo = wallHref(profile.id, { cursor });

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <h2 className="sr-only">{t("heading")}</h2>
      {viewer.user && profile.canPostOnWall && (
        <WallComposer
          action={postToWall.bind(null, profile.id, returnTo)}
          avatar={<UserAvatar user={member(viewer.user.id)} size="lg" />}
          placeholder={t("placeholder", { username: profile.username })}
          submitLabel={t("submit")}
          className="border-b p-4"
        />
      )}
      {posts.length === 0 ? (
        <EmptyState
          icon={PenLine}
          title={t("emptyTitle")}
          description={t.rich("emptyDescription", {
            username: profile.username,
            user: () => <UserLink user={profile.card} />,
          })}
        >
          {!viewer.user && (
            <Link
              href={`/login?next=${encodeURIComponent(returnTo)}`}
              className={cn(buttonVariants(), "h-10 px-4")}
            >
              {t("login")}
            </Link>
          )}
        </EmptyState>
      ) : (
        <div className="divide-y divide-border">
          {posts.map((post) => {
            const isOpen = openPage !== null && post.id === openPost?.id;
            return (
              <WallPost
                key={post.id}
                post={post}
                comments={isOpen ? openPage.items : post.latestComments}
                links={
                  isOpen
                    ? {
                        older:
                          openPage.nextCursor === null
                            ? undefined
                            : wallHref(profile.id, {
                                cursor,
                                comments: {
                                  postId: post.id,
                                  cursor: openPage.nextCursor,
                                },
                              }),
                        fewer: `${wallHref(profile.id, { cursor })}#profile-post-${post.id}`,
                      }
                    : post.commentCount > post.latestComments.length
                      ? {
                          more: `${wallHref(profile.id, {
                            cursor,
                            comments: { postId: post.id },
                          })}#profile-post-${post.id}`,
                        }
                      : {}
                }
                member={member}
                viewerId={viewerId}
                picker={picker}
                reactionTypes={reactionTypes}
                returnTo={returnTo}
              />
            );
          })}
        </div>
      )}
      {nextCursor && (
        <div className="border-t p-3">
          <LoadMore href={wallHref(profile.id, { cursor: nextCursor })} />
        </div>
      )}
    </section>
  );
}
