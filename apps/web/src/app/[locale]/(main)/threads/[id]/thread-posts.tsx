import { postsList, type threadsGet } from "@sermo/core/contracts";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type { z } from "zod";
import { MarkRead } from "@/app/[locale]/(main)/threads/[id]/mark-read";
import { isNewPost } from "@/app/[locale]/(main)/threads/[id]/new-posts";
import {
  pageCount,
  threadPageHref,
} from "@/app/[locale]/(main)/threads/[id]/pages";
import { threadMay } from "@/app/[locale]/(main)/threads/[id]/permissions";
import { PostItem } from "@/app/[locale]/(main)/threads/[id]/post-item";
import { ThreadPoll } from "@/app/[locale]/(main)/threads/[id]/thread-poll";
import { ThreadTools } from "@/app/[locale]/(main)/threads/[id]/thread-tools";
import { pollPosts } from "@/app/[locale]/(main)/threads/poll-posts";
import { LiveTail, PendingBody } from "@/components/forum/live-tail";
import { PageNav } from "@/components/forum/page-nav";
import { pageAddress } from "@/components/forum/page-window";
import { PostFrame } from "@/components/forum/post-frame";
import { LoadingRegion, PostSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { POLL_MS } from "@/lib/poll-intervals";
import { bookmarkedAmong } from "@/lib/sermo/bookmarks";
import type { read } from "@/lib/sermo/client";
import { authorsFor } from "@/lib/sermo/members";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";

type FoundThread = z.output<typeof threadsGet.output>;

// What the end of the last page of this thread is kept under while the page is open.
export const tailKey = (threadId: number) => `thread:${threadId}`;

// What the posts of a page are drawn with, from the thread's read: the page and the action that
// draws a page in place work it out alike.
export function postsContext(
  found: FoundThread,
  viewerId: number | null,
  select: boolean,
) {
  const { thread, permissions, resolvedPermissions, poll, node } = found;
  const may = threadMay(resolvedPermissions, permissions);
  // Where only titles are open to the viewer, the posts are not asked for at all.
  const contentOpen = resolvedPermissions["forum.viewContent"] !== false;
  return {
    thread,
    may,
    viewerId,
    contentOpen,
    canReactHere: resolvedPermissions["forum.react"] !== false,
    canQuote: permissions.canReply,
    selecting: select && may.split,
    highlighted:
      thread.highlightedUntil !== null &&
      Date.parse(thread.highlightedUntil) > Date.now(),
    poll: poll.exists ? { attachIn: may.attach ? node.id : null } : null,
    // What a signed-in member's action row holds (`ThreadTools`); none for a guest.
    tools:
      viewerId === null
        ? null
        : {
            watching: found.watching,
            canWatch: permissions.canWatch,
            canEditTitle: permissions.canEditTitle,
            // The tags to edit, for whoever may edit them.
            tags: permissions.canEditTags ? found.tags : null,
            addPoll:
              contentOpen && poll.canAdd
                ? { attachIn: may.attach ? node.id : null }
                : null,
            staffPick: found.featured === "staff",
            mayRemoveCover: thread.cover !== null && permissions.canRemoveCover,
          },
  };
}

export type PostsContext = ReturnType<typeof postsContext>;

// One page of the thread's posts, by its number or by the cursor of a moderator's page past the
// last visible post, with the viewer's bookmarks among them.
export async function readPosts(
  context: PostsContext,
  page: number,
  cursor: string | undefined,
  reader: typeof read,
) {
  const { thread, viewerId } = context;
  const list = await reader(
    postsList,
    cursor ? { threadId: thread.id, cursor } : { threadId: thread.id, page },
  );
  // The page's post ids are known once it is read; their bookmark state follows in the same step.
  const bookmarks =
    viewerId === null
      ? null
      : await bookmarkedAmong(
          "post",
          list.items.map((post) => post.id),
        );
  return { posts: list.items, nextCursor: list.nextCursor, bookmarks };
}

export type PostsRead = Awaited<ReturnType<typeof readPosts>>;

// The address of a page of the thread, keeping the split selection open.
function pagePath(threadId: number, selecting: boolean) {
  return {
    path: threadPageHref(threadId, 1),
    params: selecting ? { select: "1" } : {},
  };
}

// The part of the thread page that turns with its pages (`PageSwitch`): the poll on the first page,
// the action row above the posts (the pager from a wide screen up and, for a member, the thread's
// tools, as XenForo's), the posts, the pager below.
export function PostsRegion({
  context,
  page,
  cursor,
  posts,
  inPlace = false,
}: {
  context: PostsContext;
  page: number;
  cursor: string | undefined;
  posts: PostsRead | Promise<PostsRead>;
  // Drawn for `PageSwitch`: no placeholders, the switch keeps the page shown until all of it is in.
  inPlace?: boolean;
}) {
  const poll = context.poll && page === 1 && (
    <ThreadPoll
      threadId={context.thread.id}
      signedIn={context.viewerId !== null}
      attachIn={context.poll.attachIn}
    />
  );
  const list = (
    <ThreadPosts context={context} page={page} cursor={cursor} posts={posts} />
  );
  if (inPlace)
    return (
      <>
        {poll}
        {list}
      </>
    );
  return (
    <>
      {poll && (
        <Suspense fallback={<Skeleton className="mt-4 h-48 w-full" />}>
          {poll}
        </Suspense>
      )}
      <Suspense fallback={<PostsSkeleton />}>{list}</Suspense>
    </>
  );
}

async function PostsSkeleton() {
  const t = await getTranslations("threads.page");
  return (
    <LoadingRegion label={t("aria.loadingPosts")}>
      <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border bg-card">
        <PostSkeleton />
        <PostSkeleton />
        <PostSkeleton />
      </div>
    </LoadingRegion>
  );
}

async function ThreadPosts({
  context,
  page,
  cursor,
  posts: asked,
}: {
  context: PostsContext;
  page: number;
  cursor: string | undefined;
  posts: PostsRead | Promise<PostsRead>;
}) {
  const {
    thread,
    highlighted,
    viewerId,
    may,
    selecting,
    canQuote,
    canReactHere,
  } = context;
  const [
    { posts, nextCursor, bookmarks },
    reactionTypes,
    { permissions, user, resolvedPermissions: viewerCan },
  ] = await Promise.all([asked, getReactionTypes(), getViewer()]);
  // An empty page past the first is a page that does not exist.
  if (posts.length === 0 && page > 1) notFound();
  // The viewer is among the authors: the row drawn for a reply they are sending is theirs.
  const author = await authorsFor([
    ...posts.map((post) => post.author),
    ...(user ? [user] : []),
  ]);
  const picker =
    permissions.canReact && canReactHere
      ? pickerTypes(reactionTypes, thread.node.id)
      : [];
  // One signature per member on the page: under their first post.
  const seen = new Set<number>();
  const firstOfAuthor = new Set(
    posts.flatMap((post) => {
      if (seen.has(post.author.id)) return [];
      seen.add(post.author.id);
      return [post.id];
    }),
  );
  // "New" goes by where the viewer had read to before this page: `MarkRead` moves it only once the
  // page is on screen.
  const reader = {
    signedIn: viewerId !== null,
    readPosition: thread.readPosition,
  };
  const now = Date.now();
  const pages = pageCount(thread.lastPost.position);
  const lastPost = posts.at(-1);
  const lastPosition = lastPost?.position;
  // The last page goes on while it is open: replies that arrive and the viewer's own end it.
  const goesOn =
    lastPost !== undefined &&
    !cursor &&
    !selecting &&
    page >= pages &&
    !nextCursor;
  const address = pagePath(thread.id, selecting);
  // Past the last page a member sees, a moderator's view goes on by the cursor.
  const pastLast =
    page >= pages && nextCursor
      ? `${pageAddress(address.path, address.params, page + 1)}&cursor=${encodeURIComponent(nextCursor)}`
      : undefined;
  const pager = (className: string) => (
    <PageNav
      page={page}
      pages={pages}
      path={address.path}
      params={address.params}
      next={pastLast}
      className={className}
    />
  );

  return (
    <>
      {viewerId !== null && lastPosition !== undefined && (
        <MarkRead threadId={thread.id} position={lastPosition} />
      )}
      {context.tools ? (
        <ThreadTools context={context} start={pager("max-sm:hidden")} />
      ) : (
        pager("mt-4 max-sm:hidden")
      )}
      <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border bg-card">
        {posts.map((post) => (
          <PostItem
            key={post.id}
            post={post}
            author={author(post.author.id)}
            byThreadAuthor={post.author.id === thread.author.id}
            noteState={
              post.state !== "visible" &&
              !(post.id === thread.firstPostId && thread.state === post.state)
            }
            highlighted={highlighted && post.id === thread.firstPostId}
            signed={firstOfAuthor.has(post.id)}
            viewerId={viewerId}
            picker={post.state === "visible" ? picker : []}
            reactionTypes={reactionTypes}
            viewList={viewerCan["reaction.viewList"] !== false}
            may={may}
            isFirst={post.id === thread.firstPostId}
            selecting={selecting}
            canQuote={canQuote}
            bookmarked={bookmarks ? bookmarks.toggle(post.id) : null}
            isNew={isNewPost(post, reader, now)}
          />
        ))}
        {goesOn && (
          <LiveTail
            tailKey={tailKey(thread.id)}
            drawn={{ id: lastPost.id, mark: lastPost.position }}
            poll={pollPosts.bind(null, thread.id)}
            intervalMs={POLL_MS.thread}
            pendingRow={
              user && (
                <PostFrame
                  author={author(user.id)}
                  createdAt={new Date().toISOString()}
                  actions={null}
                >
                  <PendingBody />
                </PostFrame>
              )
            }
          />
        )}
      </div>
      {pager("mt-4")}
    </>
  );
}
