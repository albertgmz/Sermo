import { postsList, seoThread, threadsGet } from "@sermo/core/contracts";
import { Hourglass, Lock, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import { MarkRead } from "@/app/[locale]/(main)/threads/[id]/mark-read";
import { SplitPanel } from "@/app/[locale]/(main)/threads/[id]/moderation";
import { isNewPost } from "@/app/[locale]/(main)/threads/[id]/new-posts";
import { pageCount } from "@/app/[locale]/(main)/threads/[id]/pages";
import {
  type ThreadMay,
  threadMay,
} from "@/app/[locale]/(main)/threads/[id]/permissions";
import { PostItem } from "@/app/[locale]/(main)/threads/[id]/post-item";
import { ReplyComposer } from "@/app/[locale]/(main)/threads/[id]/reply-composer";
import { ThreadPoll } from "@/app/[locale]/(main)/threads/[id]/thread-poll";
import { ThreadTools } from "@/app/[locale]/(main)/threads/[id]/thread-tools";
import { pollPosts } from "@/app/[locale]/(main)/threads/poll-posts";
import { Art } from "@/components/forum/art";
import { EmptyState } from "@/components/forum/empty-state";
import { JsonLd } from "@/components/forum/json-ld";
import { LiveTail, PendingBody } from "@/components/forum/live-tail";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PollAdder } from "@/components/forum/poll-adder";
import { PostFrame, PostNote } from "@/components/forum/post-frame";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { LoadingRegion, PostSkeleton } from "@/components/forum/skeletons";
import { ThreadTags } from "@/components/forum/thread-tags";
import { ThreadTagsEditor } from "@/components/forum/thread-tags-editor";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { POLL_MS } from "@/lib/poll-intervals";
import { canonicalPathOf, canonicalUrlOf } from "@/lib/sermo/addresses";
import { bookmarkedAmong } from "@/lib/sermo/bookmarks";
import { read } from "@/lib/sermo/client";
import { parsePageId } from "@/lib/sermo/ids";
import { authorsFor } from "@/lib/sermo/members";
import { POSTS_PER_PAGE } from "@/lib/sermo/page-sizes";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { copyOf, seoMetadata } from "@/lib/sermo/seo";
import { getViewer } from "@/lib/sermo/session";
import { publicHead } from "@/lib/sermo/share";
import { prefixView } from "@/lib/sermo/threads";
import { cn } from "@/lib/utils";

// The thread is asked once for the metadata and the page: asking counts a view. The backend
// follows a merge; the proxy sends a page load there already, but a soft navigation reaches this.
const getThread = cache(async (threadId: number) => {
  const found = await read(threadsGet, { threadId });
  if (found.seo.redirect)
    permanentRedirect(canonicalPathOf(found.seo.canonical));
  return found;
});

// What the backend says about the page being shown. The thread's own read carries the first
// page; a later page asks for its own (one more read), and a view by cursor is a copy of the
// first page.
const getSeo = cache(
  async (threadId: number, page: number, byCursor: boolean) => {
    const { seo } = await getThread(threadId);
    if (byCursor) return copyOf(seo);
    return page === 1
      ? seo
      : read(seoThread, { threadId, page, pageSize: POSTS_PER_PAGE });
  },
);

function pageNumber(raw: string | string[] | undefined) {
  return Math.max(1, Math.floor(Number(raw)) || 1);
}

function threadIdOf(raw: string) {
  const id = parsePageId(raw);
  if (id === null) notFound();
  return id;
}

// The thread starter's page on the canonical's origin: the slugged address the structured data
// names, or their plain one (which leads there) when the text is closed to the viewer.
function authorUrl(seo: { canonical: string; jsonLd: unknown[] }, id: number) {
  for (const item of seo.jsonLd) {
    const url = (item as { author?: { url?: unknown } }).author?.url;
    if (typeof url === "string") return canonicalUrlOf(url);
  }
  return new URL(`/members/${id}`, new URL(seo.canonical).origin).href;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/[locale]/threads/[id]">): Promise<Metadata> {
  const [{ id }, { page, cursor }] = await Promise.all([params, searchParams]);
  const threadId = threadIdOf(id);
  const head = seoMetadata(
    await getSeo(threadId, pageNumber(page), cursor !== undefined),
  );
  // Shared as an article only when the thread is open to guests (the backend indexes it).
  const { thread, node, tags, seo } = await getThread(threadId);
  if (seo.robots !== "index,follow") return head;
  return publicHead(head, {
    title: thread.title,
    markdown: true,
    card: { kind: "threads", id: thread.id, seo },
    kind: {
      type: "article",
      publishedTime: thread.createdAt,
      modifiedTime: thread.lastPost.postedAt,
      author: authorUrl(seo, thread.author.id),
      section: node.title,
      tags,
    },
  });
}

export default async function ThreadPage({
  params,
  searchParams,
}: PageProps<"/[locale]/threads/[id]">) {
  const [{ id: raw }, { page: pageParam, cursor, select }] = await Promise.all([
    params,
    searchParams,
  ]);
  const id = threadIdOf(raw);
  const [
    {
      thread,
      tags,
      poll,
      node,
      permissions,
      resolvedPermissions,
      watching,
      featured,
    },
    { user },
    bookmarks,
    t,
  ] = await Promise.all([
    getThread(id),
    getViewer(),
    // Settled by the same request-wide viewer read; guests ask nothing.
    getViewer().then(({ user: viewer }) =>
      viewer ? bookmarkedAmong("thread", [id]) : null,
    ),
    getTranslations("threads.page"),
  ]);
  const page = pageNumber(pageParam);
  const seo = await getSeo(id, page, cursor !== undefined);
  const may = threadMay(resolvedPermissions, permissions);
  // Where only titles are open to the viewer, the posts are not asked for at all.
  const contentOpen = resolvedPermissions["forum.viewContent"] !== false;
  const canReactHere = resolvedPermissions["forum.react"] !== false;
  const mayRemoveCover = thread.cover !== null && permissions.canRemoveCover;
  const selecting = select === "1" && may.split;
  const prefix = prefixView(thread.prefix);
  const highlighted =
    thread.highlightedUntil !== null &&
    Date.parse(thread.highlightedUntil) > Date.now();

  return (
    <PageLayout className="pt-2">
      <JsonLd items={seo.jsonLd} />
      <header
        className={cn(
          thread.cover && "relative isolate overflow-hidden rounded-lg border",
        )}
      >
        {thread.cover && (
          <Art
            category="threadCovers"
            src={thread.cover.url}
            className="absolute inset-0 -z-10"
          />
        )}
        <div
          className={cn(
            thread.cover &&
              "bg-linear-to-t from-background/90 from-[calc(100%-5rem)] to-transparent px-3 pt-24 pb-3 md:px-4 md:pt-32 md:pb-4",
          )}
        >
          <PageBreadcrumb
            items={[
              { label: t("home"), href: "/" },
              { label: node.title, href: `/forums/${node.id}` },
            ]}
          />
          <h1 className="mt-1 text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
            {prefix && (
              <PrefixTag prefix={prefix} className="mr-2 align-[0.1875rem]" />
            )}
            {thread.title}
          </h1>
        </div>
      </header>

      {(tags.length > 0 || permissions.canEditTags) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <ThreadTags tags={tags} />
          {permissions.canEditTags && (
            <ThreadTagsEditor threadId={thread.id} tags={tags} />
          )}
        </div>
      )}

      {contentOpen && poll.canAdd && (
        <div className="mt-2">
          <PollAdder
            threadId={thread.id}
            attachIn={may.attach ? node.id : null}
          />
        </div>
      )}

      {user && (
        <ThreadTools
          thread={thread}
          watching={watching}
          bookmarked={bookmarks ? bookmarks.toggle(thread.id) : null}
          canWatch={permissions.canWatch}
          may={may}
          mayRemoveCover={mayRemoveCover}
          staffPick={featured === "staff"}
          selecting={selecting}
        />
      )}
      {selecting && (
        <Suspense fallback={<Skeleton className="mt-3 h-40 w-full" />}>
          <SplitPanel thread={thread} />
        </Suspense>
      )}

      {thread.state === "moderated" && (
        <PostNote icon={Hourglass}>{t("threadAwaitingApproval")}</PostNote>
      )}
      {thread.state === "deleted" && (
        <PostNote icon={Trash2}>{t("threadDeleted")}</PostNote>
      )}

      {contentOpen && poll.exists && page === 1 && (
        <Suspense fallback={<Skeleton className="mt-4 h-48 w-full" />}>
          <ThreadPoll
            threadId={thread.id}
            signedIn={user !== null}
            attachIn={may.attach ? node.id : null}
          />
        </Suspense>
      )}

      {!contentOpen && <PostNote icon={Lock}>{t("contentClosed")}</PostNote>}
      {contentOpen && (
        <Suspense
          fallback={
            <LoadingRegion label={t("aria.loadingPosts")}>
              <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border bg-card">
                <PostSkeleton />
                <PostSkeleton />
                <PostSkeleton />
              </div>
            </LoadingRegion>
          }
        >
          <ThreadPosts
            thread={thread}
            highlighted={highlighted}
            page={page}
            cursor={typeof cursor === "string" ? cursor : undefined}
            viewerId={user?.id ?? null}
            may={may}
            selecting={selecting}
            canQuote={permissions.canReply}
            canReactHere={canReactHere}
          />
        </Suspense>
      )}

      {contentOpen && (
        <section
          id="reply"
          aria-label={t("aria.reply")}
          className="mt-4 scroll-mt-4"
        >
          {permissions.canReply ? (
            <>
              {thread.isLocked && (
                <PostNote icon={Lock}>{t("lockedModerators")}</PostNote>
              )}
              <ReplyComposer
                key={thread.lastPost.postId}
                threadId={thread.id}
                tailKey={tailKey(thread.id)}
                attachIn={may.attach ? node.id : null}
              />
            </>
          ) : user ? (
            <PostNote icon={Lock}>
              {thread.isLocked ? t("locked") : t("cannotReply")}
            </PostNote>
          ) : (
            <div className="rounded-lg border bg-card">
              <EmptyState
                title={t("replyTitle")}
                description={t("replyDescription")}
              >
                <Link
                  href={`/login?next=${encodeURIComponent(`/threads/${thread.id}`)}`}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "h-10 px-4",
                  )}
                >
                  {t("login")}
                </Link>
                <Link
                  href="/register"
                  className={cn(buttonVariants(), "h-10 px-4")}
                >
                  {t("register")}
                </Link>
              </EmptyState>
            </div>
          )}
        </section>
      )}
    </PageLayout>
  );
}

// What the end of the last page of this thread is kept under while the page is open.
const tailKey = (threadId: number) => `thread:${threadId}`;

function pageHref(
  threadId: number,
  page: number,
  cursor?: string,
  selecting = false,
) {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (cursor) params.set("cursor", cursor);
  if (selecting) params.set("select", "1");
  const query = params.toString();
  return `/threads/${threadId}${query ? `?${query}` : ""}`;
}

async function ThreadPosts({
  thread,
  highlighted,
  page,
  cursor,
  viewerId,
  may,
  selecting,
  canQuote,
  canReactHere,
}: {
  thread: Awaited<ReturnType<typeof getThread>>["thread"];
  highlighted: boolean;
  page: number;
  cursor: string | undefined;
  viewerId: number | null;
  may: ThreadMay;
  selecting: boolean;
  canQuote: boolean;
  canReactHere: boolean;
}) {
  const [
    {
      list: { items: posts, nextCursor },
      bookmarks,
    },
    reactionTypes,
    { permissions, user, resolvedPermissions: viewerCan },
    t,
    format,
  ] = await Promise.all([
    // The page's post ids are known once it is read; their bookmark state follows in the same step.
    read(
      postsList,
      cursor ? { threadId: thread.id, cursor } : { threadId: thread.id, page },
    ).then(async (list) => ({
      list,
      bookmarks:
        viewerId === null
          ? null
          : await bookmarkedAmong(
              "post",
              list.items.map((post) => post.id),
            ),
    })),
    getReactionTypes(),
    getViewer(),
    getTranslations("threads.page"),
    getFormatter(),
  ]);
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

  return (
    <>
      {viewerId !== null && lastPosition !== undefined && (
        <MarkRead threadId={thread.id} position={lastPosition} />
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
      {(pages > 1 || page > 1 || nextCursor) && (
        <nav
          aria-label={t("aria.pages")}
          className="mt-4 flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-xs text-muted-foreground">
            {t("pagination", {
              page: format.number(page),
              pages: format.number(Math.max(pages, page)),
            })}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={pageHref(thread.id, page - 1, undefined, selecting)}
                className={buttonVariants({
                  variant: "outline",
                  className: "min-h-10",
                })}
              >
                {t("previous")}
              </Link>
            )}
            {(page < pages || nextCursor) && (
              <Link
                href={pageHref(
                  thread.id,
                  page + 1,
                  page < pages ? undefined : (nextCursor ?? undefined),
                  selecting,
                )}
                className={buttonVariants({
                  variant: "outline",
                  className: "min-h-10",
                })}
              >
                {t("next")}
              </Link>
            )}
          </div>
        </nav>
      )}
    </>
  );
}
