import {
  profileCommentsList,
  profileCommentsLocate,
  profilePostsList,
  profilePostsLocate,
} from "@sermo/core/contracts";
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
import { earlierComments } from "@/app/[locale]/(main)/members/earlier-comments";
import { PostComposer } from "@/app/[locale]/(main)/members/post-composer";
import { PostAttachments } from "@/app/[locale]/(main)/threads/[id]/post-attachments";
import { DeletedItem } from "@/components/forum/deleted-item";
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
  type EarlierLoad,
  hasWallComments,
  oldestFirst,
  WallComments,
  WallDeletionNotice,
  WallStateNote,
} from "@/components/forum/wall-comments";
import {
  WallItemActions,
  WallItemSummary,
} from "@/components/forum/wall-item-actions";
import { buttonVariants } from "@/components/ui/button";
import { inlineAttachmentIds } from "@/lib/attachment-tags";
import { formatNumber } from "@/lib/format";
import { call, read } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
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
  earlier,
  links,
  member,
  viewerId,
  picker,
  reactionTypes,
  viewList,
  returnTo,
  mayHardDelete,
  mayUndelete,
}: {
  post: ApiWallPost;
  // The newest few, or one page of them where the post is open.
  comments: ApiWallComment[];
  // Loads the older comments in place, where there are any.
  earlier?: EarlierLoad;
  // Back to the newest few, where the post is open at an older page.
  links: { fewer?: string };
  member: (id: number) => MemberView;
  viewerId: number | null;
  picker: ReactionType[];
  reactionTypes: ReactionTypes;
  viewList: boolean;
  returnTo: string;
  mayHardDelete: boolean;
  mayUndelete: boolean;
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
  // Who reacted heads the block of comments, as on XenForo; with no block, it sits under the bar.
  const block = hasWallComments(post, comments, earlier);
  const actions = {
    kind: "post" as const,
    item: post,
    address: { profileUserId: post.profileUserId, postId: post.id },
    viewerId,
    picker,
    reactionTypes,
    viewList,
    mayHardDelete,
    mayUndelete,
  };
  // A deleted post folds to its deletion notice (`DeletedItem`), its comments with it.
  const folded = post.state === "deleted";
  const notice = folded && (
    <WallDeletionNotice
      deletion={post.deletion}
      tools={<WallItemActions {...actions} part="tools" />}
      className="mt-0 mb-1"
    />
  );
  const time = (
    <>
      <RelativeTime date={post.createdAt} />
      {post.editedAt && <EditedMark date={post.editedAt} className="ml-1.5" />}
    </>
  );
  const full = (
    <MessageRow
      id={anchor}
      author={member(post.author.id)}
      time={time}
      actions={
        <WallItemActions
          {...actions}
          part={folded ? "footer" : undefined}
          summary={!block}
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
                className={cn(
                  messageActionClass,
                  // Not a button: no pill.
                  "pointer-events-none bg-transparent",
                )}
              >
                {count}
              </span>
            )
          }
        />
      }
      footer={
        block && (
          <WallComments
            anchor={anchor}
            profileUserId={post.profileUserId}
            comments={comments}
            earlier={earlier}
            summary={
              <WallItemSummary
                kind="post"
                item={post}
                viewerId={viewerId}
                picker={picker}
                reactionTypes={reactionTypes}
                viewList={viewList}
              />
            }
            links={links}
            action={
              post.canComment
                ? commentOnWallPost.bind(null, post.id, post.profileUserId)
                : undefined
            }
            member={member}
            viewerId={viewerId}
            picker={picker}
            reactionTypes={reactionTypes}
            viewList={viewList}
            mayUndelete={mayUndelete}
          />
        )
      }
    >
      {notice || <WallStateNote state={post.state} />}
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
  if (!folded) return full;
  return (
    <DeletedItem
      collapsed={
        <MessageRow id={anchor} author={member(post.author.id)} time={time}>
          {notice}
        </MessageRow>
      }
    >
      {full}
    </DeletedItem>
  );
}

// A post (and a comment on it) an address names, which the wall brings to the page that shows it.
export type WallFocus = { postId: number; commentId?: number };

// Where the backend places the named post on this wall (the page of posts that holds it) and the
// named comment among its post's comments; null for one it cannot place here (gone, hidden from
// the viewer, on another wall), which leaves the wall at its first page.
async function locate(profileId: number, focus: WallFocus) {
  const placed = (error: unknown) => {
    if (error instanceof SermoError && error.status < 500) return null;
    throw error;
  };
  if (focus.commentId !== undefined) {
    const found = await call(profileCommentsLocate, {
      commentId: focus.commentId,
    }).catch(placed);
    return found?.profileUserId === profileId &&
      found.profilePostId === focus.postId
      ? { cursor: found.wallCursor, commentsCursor: found.commentsCursor }
      : null;
  }
  const found = await call(profilePostsLocate, {
    profilePostId: focus.postId,
  }).catch(placed);
  return found?.profileUserId === profileId
    ? { cursor: found.cursor, commentsCursor: null }
    : null;
}

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
  // A named post opens the page of the wall that holds it, for every visitor.
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
  const located =
    focus !== undefined && requested === undefined
      ? await locate(profile.id, focus)
      : null;
  const cursor = located ? (located.cursor ?? undefined) : requested;
  const [{ items: posts, nextCursor }, reactionTypes, t, loadMore] =
    await Promise.all([
      read(profilePostsList, { userId: profile.id, cursor }),
      getReactionTypes(),
      getTranslations("members.wall"),
      getTranslations("members.loadMore"),
    ]);
  // A named comment that is not among the newest few opens the page of comments that holds it.
  const focused =
    located && focus?.commentId !== undefined && !requestedOpen
      ? posts.find((post) => post.id === focus.postId)
      : undefined;
  const open: OpenComments | undefined =
    focused &&
    !focused.latestComments.some((comment) => comment.id === focus?.commentId)
      ? {
          postId: focused.id,
          cursor: located?.commentsCursor ?? undefined,
        }
      : requestedOpen;
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
  const picker =
    viewer.permissions.canReact &&
    viewer.resolvedPermissions["profilePost.react"] !== false
      ? pickerTypes(reactionTypes, null)
      : [];
  const viewList = viewer.resolvedPermissions["reaction.viewList"] !== false;
  // The page as it is drawn, which the links on it keep.
  const here = { cursor };
  const returnTo = wallHref(profile.id, here);

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
            const oldest = oldestFirst(post.latestComments)[0];
            return (
              <WallPost
                key={post.id}
                post={post}
                comments={isOpen ? openPage.items : post.latestComments}
                earlier={
                  isOpen
                    ? openPage.nextCursor === null
                      ? undefined
                      : {
                          load: earlierComments.bind(
                            null,
                            post.id,
                            profile.id,
                            null,
                            openPage.nextCursor,
                          ),
                        }
                    : oldest && post.commentCount > post.latestComments.length
                      ? {
                          load: earlierComments.bind(
                            null,
                            post.id,
                            profile.id,
                            oldest.id,
                            null,
                          ),
                        }
                      : undefined
                }
                links={
                  isOpen
                    ? {
                        fewer: `${wallHref(profile.id, here)}#profile-post-${post.id}`,
                      }
                    : {}
                }
                member={member}
                viewerId={viewerId}
                picker={picker}
                reactionTypes={reactionTypes}
                viewList={viewList}
                returnTo={returnTo}
                mayHardDelete={
                  viewer.resolvedPermissions["profilePost.hardDelete"] === true
                }
                mayUndelete={
                  viewer.resolvedPermissions["profilePost.undelete"] === true
                }
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
