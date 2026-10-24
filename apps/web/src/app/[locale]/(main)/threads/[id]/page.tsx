import { seoThread, threadsGet } from "@sermo/core/contracts";
import { Hourglass, Lock, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import { SplitPanel } from "@/app/[locale]/(main)/threads/[id]/moderation";
import { postsPage } from "@/app/[locale]/(main)/threads/[id]/posts-page";
import { ReplyComposer } from "@/app/[locale]/(main)/threads/[id]/reply-composer";
import { ThreadHeading } from "@/app/[locale]/(main)/threads/[id]/thread-heading";
import {
  PostsRegion,
  postsContext,
  readPosts,
  tailKey,
} from "@/app/[locale]/(main)/threads/[id]/thread-posts";
import { ThreadTools } from "@/app/[locale]/(main)/threads/[id]/thread-tools";
import { replyAction } from "@/app/[locale]/(main)/threads/actions";
import { replyInPlace } from "@/app/[locale]/(main)/threads/reply-in-place";
import { Art } from "@/components/forum/art";
import { EmptyState } from "@/components/forum/empty-state";
import { JsonLd } from "@/components/forum/json-ld";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PageSwitch } from "@/components/forum/page-switch";
import { PollAdder } from "@/components/forum/poll-adder";
import { PostNote } from "@/components/forum/post-frame";
import { ThreadTags } from "@/components/forum/thread-tags";
import { ThreadTagsEditor } from "@/components/forum/thread-tags-editor";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { canonicalPathOf, canonicalUrlOf } from "@/lib/sermo/addresses";
import { bookmarkedAmong } from "@/lib/sermo/bookmarks";
import { read } from "@/lib/sermo/client";
import { parsePageId } from "@/lib/sermo/ids";
import { POSTS_PER_PAGE } from "@/lib/sermo/page-sizes";
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
  const [found, { user }, bookmarks, t, tReply] = await Promise.all([
    getThread(id),
    getViewer(),
    // Settled by the same request-wide viewer read; guests ask nothing.
    getViewer().then(({ user: viewer }) =>
      viewer ? bookmarkedAmong("thread", [id]) : null,
    ),
    getTranslations("threads.page"),
    getTranslations("threads.replyComposer"),
  ]);
  const { thread, tags, poll, node, permissions, watching, featured } = found;
  const page = pageNumber(pageParam);
  const seo = await getSeo(id, page, cursor !== undefined);
  const posts = postsContext(found, user?.id ?? null, select === "1");
  const { may, contentOpen, selecting } = posts;
  const postsCursor = typeof cursor === "string" ? cursor : undefined;
  const mayRemoveCover = thread.cover !== null && permissions.canRemoveCover;

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
            <ThreadHeading
              threadId={thread.id}
              title={thread.title}
              prefix={prefixView(thread.prefix)}
            />
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
          canEditTitle={permissions.canEditTitle}
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

      {!contentOpen && <PostNote icon={Lock}>{t("contentClosed")}</PostNote>}
      {contentOpen && (
        <PageSwitch
          page={page}
          stamp={Date.now()}
          load={postsPage.bind(null, thread.id, selecting)}
        >
          <PostsRegion
            context={posts}
            page={page}
            cursor={postsCursor}
            posts={readPosts(posts, page, postsCursor, read)}
          />
        </PageSwitch>
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
                replyInPlace={replyInPlace.bind(null, thread.id)}
                replyAction={replyAction.bind(null, thread.id)}
                tailKey={tailKey(thread.id)}
                files={may.attach ? { nodeId: node.id } : null}
                placeholder={tReply("placeholder")}
                submitLabel={tReply("submit")}
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
