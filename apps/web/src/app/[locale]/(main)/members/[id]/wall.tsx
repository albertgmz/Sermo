import { profileCommentsList, profilePostsList } from "@sermo/core/contracts";
import { MessageCircle, PenLine } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import type { Profile } from "@/app/[locale]/(main)/members/[id]/profile";
import {
  commentOnWallPost,
  postToWall,
} from "@/app/[locale]/(main)/members/actions";
import { PostComposer } from "@/app/[locale]/(main)/members/post-composer";
import { PostAttachments } from "@/app/[locale]/(main)/threads/[id]/post-attachments";
import { EditedMark } from "@/components/forum/edited-mark";
import { EmptyState } from "@/components/forum/empty-state";
import { HtmlContent } from "@/components/forum/html-content";
import { LoadMore } from "@/components/forum/load-more";
import { MessageRow, messageActionClass } from "@/components/forum/message-row";
import type { ReactionType } from "@/components/forum/reaction-button";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import {
  type ApiWallComment,
  hasWallComments,
  WallComments,
  WallStateNote,
} from "@/components/forum/wall-comments";
import { WallItemActions } from "@/components/forum/wall-item-actions";
import { buttonVariants } from "@/components/ui/button";
import { inlineAttachmentIds } from "@/lib/attachment-tags";
import { formatNumber } from "@/lib/format";
import { read } from "@/lib/sermo/client";
import { pageHolding } from "@/lib/sermo/locate";
import { membersFor } from "@/lib/sermo/members";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

type ApiWallPost = z.output<typeof profilePostsList.output>["items"][number];
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

function WallPost({
  post,
  comments,
  links,
  member,
  viewerId,
  picker,
  reactionTypes,
  viewList,
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
  viewList: boolean;
  returnTo: string;
}) {
  const locale = useLocale();
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
      {formatNumber(post.commentCount, locale)}
    </>
  );
  const label = t("aria.comments", { count: post.commentCount });
  return (
    <MessageRow
      id={anchor}
      author={member(post.author.id)}
      time={
        <>
          <RelativeTime date={post.createdAt} />
          {post.editedAt && (
            <EditedMark date={post.editedAt} className="ml-1.5" />
          )}
        </>
      }
      actions={
        <WallItemActions
          kind="post"
          item={post}
          address={{ profileUserId: post.profileUserId, postId: post.id }}
          viewerId={viewerId}
          picker={picker}
          reactionTypes={reactionTypes}
          viewList={viewList}
          start={
            commentsHref ? (
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
            )
          }
        />
      }
      footer={
        hasWallComments(post, comments, links) && (
          <WallComments
            anchor={anchor}
            profileUserId={post.profileUserId}
            comments={comments}
            links={links}
            action={
              post.canComment
                ? commentOnWallPost.bind(null, post.id, returnTo)
                : undefined
            }
            member={member}
            viewerId={viewerId}
            picker={picker}
            reactionTypes={reactionTypes}
            viewList={viewList}
          />
        )
      }
    >
      <WallStateNote state={post.state} />
      <HtmlContent
        content={{ type: "profile_post", id: post.id }}
        attachments={post.attachments}
      >
        {post.bodyHtml}
      </HtmlContent>
      <PostAttachments
        attachments={post.attachments}
        inline={inlineAttachmentIds(post.bodyHtml, post.attachments)}
      />
    </MessageRow>
  );
}

// A post (and a comment on it) an address names, which the wall brings to the page that shows it.
export type WallFocus = { postId: number; commentId?: number };

export async function Wall({
  profile,
  cursor: requested,
  open: requestedOpen,
  focus,
}: {
  profile: Profile;
  cursor?: string;
  open?: OpenComments;
  focus?: WallFocus;
}) {
  // A named post that the first page does not hold is looked for further down the wall, and the
  // wall continues from the page that has it. Alerts exist only for members: a guest gets the
  // first page.
  const viewer = await getViewer();
  // The backend refuses the wall to a viewer without `profilePost.view`: draw none.
  if (viewer.resolvedPermissions["profilePost.view"] === false) {
    const t = await getTranslations("members.wall");
    return (
      <EmptyState
        icon={PenLine}
        title={t("unavailableTitle")}
        description={t("unavailableDescription")}
      />
    );
  }
  const walk =
    focus && requested === undefined && viewer.user
      ? await pageHolding(
          (at) => read(profilePostsList, { userId: profile.id, cursor: at }),
          (post) => post.id === focus.postId,
        )
      : null;
  const cursor = walk?.hit ? walk.hit.cursor : requested;
  const [{ items: posts, nextCursor }, reactionTypes, t, loadMore] =
    await Promise.all([
      walk
        ? Promise.resolve(walk.hit?.page ?? walk.first)
        : read(profilePostsList, { userId: profile.id, cursor }),
      getReactionTypes(),
      getTranslations("members.wall"),
      getTranslations("members.loadMore"),
    ]);
  // A named comment that is not among the newest few opens the page of comments that holds it.
  const focused =
    focus?.commentId !== undefined && viewer.user && !requestedOpen
      ? posts.find((post) => post.id === focus.postId)
      : undefined;
  const commentHit =
    focused && !focused.latestComments.some((c) => c.id === focus?.commentId)
      ? await pageHolding(
          (at) =>
            read(profileCommentsList, {
              profilePostId: focused.id,
              cursor: at,
            }),
          (comment) => comment.id === focus?.commentId,
        )
      : null;
  const open: OpenComments | undefined = commentHit?.hit
    ? { postId: focused?.id ?? 0, cursor: commentHit.hit.cursor }
    : requestedOpen;
  const openPost = open && posts.find((post) => post.id === open.postId);
  const openPage = openPost
    ? (commentHit?.hit?.page ??
      (await read(profileCommentsList, {
        profilePostId: openPost.id,
        cursor: open?.cursor,
      })))
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
  const picker =
    viewer.permissions.canReact &&
    viewer.resolvedPermissions["profilePost.react"] !== false
      ? pickerTypes(reactionTypes, null)
      : [];
  const viewList = viewer.resolvedPermissions["reaction.viewList"] !== false;
  const returnTo = wallHref(profile.id, { cursor });

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <h2 className="sr-only">{t("heading")}</h2>
      {viewer.user && profile.canPostOnWall && (
        <PostComposer
          action={postToWall.bind(null, profile.id, returnTo)}
          avatar={<UserAvatar user={member(viewer.user.id)} size="lg" />}
          name={viewer.user.username}
          placeholder={t("placeholder", { username: profile.username })}
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
                viewList={viewList}
                returnTo={returnTo}
              />
            );
          })}
        </div>
      )}
      {nextCursor && (
        <div className="border-t p-3">
          <LoadMore href={wallHref(profile.id, { cursor: nextCursor })}>
            {loadMore("label")}
          </LoadMore>
        </div>
      )}
    </section>
  );
}
