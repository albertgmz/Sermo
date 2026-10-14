import { postsList, seoThread, threadsGet } from "@sermo/core/contracts";
import {
  Hourglass,
  Lock,
  MoreHorizontal,
  Pencil,
  PenLine,
  Reply,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import { MarkRead } from "@/app/[locale]/(main)/threads/[id]/mark-read";
import {
  SPLIT_FORM,
  SplitPanel,
} from "@/app/[locale]/(main)/threads/[id]/moderation";
import {
  pageCount,
  threadHref,
} from "@/app/[locale]/(main)/threads/[id]/pages";
import {
  mayRestore,
  type ThreadMay,
  threadMay,
} from "@/app/[locale]/(main)/threads/[id]/permissions";
import { PostAttachments } from "@/app/[locale]/(main)/threads/[id]/post-attachments";
import { QUOTE_EVENT } from "@/app/[locale]/(main)/threads/[id]/quote";
import { ReplyComposer } from "@/app/[locale]/(main)/threads/[id]/reply-composer";
import { ThreadTools } from "@/app/[locale]/(main)/threads/[id]/thread-tools";
import {
  deletePostAction,
  quoteSource,
  reportPostAction,
  restorePostAction,
} from "@/app/[locale]/(main)/threads/actions";
import { ActionForm } from "@/components/forum/action-form";
import { Art } from "@/components/forum/art";
import { DeleteControl } from "@/components/forum/delete-control";
import { EmptyState } from "@/components/forum/empty-state";
import { HtmlContent } from "@/components/forum/html-content";
import { JsonLd } from "@/components/forum/json-ld";
import { memberActionsOf } from "@/components/forum/member-actions";
import { messageActionClass } from "@/components/forum/message-row";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PostFrame, PostNote } from "@/components/forum/post-frame";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { QuoteButton } from "@/components/forum/quote-button";
import type { ReactionType } from "@/components/forum/reaction-button";
import { Reactions } from "@/components/forum/reactions";
import { RelativeTime } from "@/components/forum/relative-time";
import { ShareButton } from "@/components/forum/share-button";
import { LoadingRegion, PostSkeleton } from "@/components/forum/skeletons";
import { HashLink } from "@/components/layout/hash-link";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { canonicalPathOf } from "@/lib/sermo/addresses";
import { read } from "@/lib/sermo/client";
import { parsePageId } from "@/lib/sermo/ids";
import { authorsFor, relationsFor } from "@/lib/sermo/members";
import { POSTS_PER_PAGE } from "@/lib/sermo/page-sizes";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { copyOf, seoMetadata } from "@/lib/sermo/seo";
import { getViewer } from "@/lib/sermo/session";
import { type ApiPost, prefixView } from "@/lib/sermo/threads";
import type { AuthorView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

const QUIET_ICON =
  "inline-flex size-10 items-center justify-center rounded-md transition-colors hover:text-foreground md:size-7 [&_svg]:size-3.5";
const LABEL = "sr-only sm:not-sr-only";

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

function PostItem({
  post,
  author,
  postbitActions,
  byThreadAuthor,
  noteState,
  highlighted,
  signed,
  viewerId,
  picker,
  reactionTypes,
  may,
  isFirst,
  selecting,
  canQuote,
}: {
  post: ApiPost;
  author: AuthorView;
  // What the viewer can do about the author; none for a guest or for themselves.
  postbitActions: React.ReactNode;
  byThreadAuthor: boolean;
  // Whether the post says it is waiting or deleted; the thread says so already for its own state.
  noteState: boolean;
  highlighted: boolean;
  signed: boolean;
  viewerId: number | null;
  // What the picker offers; none when the viewer may not react to this post.
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
  may: ThreadMay;
  // The opening post cannot be deleted or split off on its own.
  isFirst: boolean;
  // The posts carry a tick for the split form.
  selecting: boolean;
  canQuote: boolean;
}) {
  const t = useTranslations("threads.page");
  const number = post.position + 1;
  const href = threadHref(post.threadId, post.position, post.id);

  return (
    <PostFrame
      id={`post-${post.id}`}
      author={author}
      postbitActions={postbitActions}
      createdAt={post.createdAt}
      highlighted={highlighted}
      edited={
        post.editedAt && (
          <span className="shrink-0">
            {t.rich("edited", {
              time: () => <RelativeTime date={post.editedAt ?? ""} />,
            })}
          </span>
        )
      }
      trailing={
        <>
          {highlighted && (
            <span className="mr-1.5 inline-flex items-center gap-1 text-(length:--text-caption) font-medium text-primary">
              <Sparkles aria-hidden="true" className="size-3" />
              <span className={LABEL}>{t("highlightedLabel")}</span>
            </span>
          )}
          {byThreadAuthor && (
            <span className="mr-1.5 inline-flex items-center gap-1 text-(length:--text-caption) font-medium">
              <PenLine aria-hidden="true" className="hidden size-3 sm:block" />
              {t.rich("authorLabel", {
                hidden: (chunks) => <span className="sr-only">{chunks}</span>,
              })}
            </span>
          )}
          <ShareButton href={href} className={QUIET_ICON} />
          <HashLink
            href={href}
            className="inline-flex h-10 min-w-10 items-center justify-center px-1.5 tabular-nums hover:text-foreground md:h-7 md:min-w-7"
          >
            {t("postNumber", { number })}
          </HashLink>
        </>
      }
      signed={signed}
      actions={
        <>
          <Reactions
            target="post"
            id={post.id}
            reactions={post.reactions}
            authorId={post.author.id}
            viewerId={viewerId}
            picker={picker}
            reactionTypes={reactionTypes}
            className="mr-auto"
          />
          {canQuote && post.state === "visible" && (
            <QuoteButton
              postId={post.id}
              event={QUOTE_EVENT}
              load={quoteSource}
              label={t("quote")}
            />
          )}
          <HashLink href="#reply" className={messageActionClass}>
            <Reply />
            {t("reply")}
          </HashLink>
          {post.canEdit && (
            <Link
              href={`/threads/${post.threadId}/edit/${post.id}`}
              className={messageActionClass}
            >
              <Pencil />
              {t("edit")}
            </Link>
          )}
        </>
      }
      after={
        viewerId !== null &&
        post.state !== "deleted" &&
        (post.canReport || post.canDelete) && (
          <details className="group mt-1">
            <summary
              aria-label={t("aria.more")}
              className={cn(
                messageActionClass,
                "ml-auto w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
              )}
            >
              <MoreHorizontal />
              {t("more")}
            </summary>
            <div className="mt-2 space-y-4 rounded-md border bg-muted/30 p-3">
              {post.canReport && (
                <ActionForm
                  action={reportPostAction.bind(null, post.id)}
                  submit={t("report")}
                  done={t("reported")}
                >
                  <Input
                    name="reason"
                    required
                    aria-label={t("reportReason")}
                    placeholder={t("reportReason")}
                    autoComplete="off"
                  />
                </ActionForm>
              )}
              {post.canDelete && (
                <DeleteControl
                  action={deletePostAction.bind(null, post.threadId, post.id)}
                  label={t("delete")}
                  confirm={t("confirmDelete")}
                  cancel={t("cancel")}
                  reasonLabel={t("deleteReason")}
                />
              )}
            </div>
          </details>
        )
      }
    >
      {/* The first post cannot be split off: a hint that copies the backend's threads.split rule,
            whose refusal is shown under the split form if the hint is ever wrong. */}
      {selecting && !isFirst && (
        <label className="mt-1 flex min-h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="postIds"
            value={post.id}
            form={SPLIT_FORM}
            className="size-5 accent-primary"
          />
          {t("selectPost", { number })}
        </label>
      )}

      {noteState && post.state === "moderated" && (
        <PostNote icon={Hourglass}>{t("awaitingApproval")}</PostNote>
      )}
      {noteState && post.state === "deleted" && (
        <PostNote icon={Trash2}>{t("deleted")}</PostNote>
      )}
      {noteState && mayRestore(may, post.state) && (
        <ActionForm
          action={restorePostAction.bind(null, post.threadId, post.id)}
          submit={post.state === "moderated" ? t("approve") : t("restore")}
          className="mt-2"
        />
      )}

      {post.state === "deleted" ? (
        <details className="mt-2">
          <summary className="flex min-h-10 cursor-pointer items-center text-sm text-muted-foreground">
            {t("showDeleted")}
          </summary>
          <HtmlContent>{post.bodyHtml}</HtmlContent>
          <PostAttachments attachments={post.attachments} />
        </details>
      ) : (
        <>
          <HtmlContent className="md:mt-1">{post.bodyHtml}</HtmlContent>
          <PostAttachments attachments={post.attachments} />
        </>
      )}
    </PostFrame>
  );
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/[locale]/threads/[id]">): Promise<Metadata> {
  const [{ id }, { page, cursor }] = await Promise.all([params, searchParams]);
  return seoMetadata(
    await getSeo(threadIdOf(id), pageNumber(page), cursor !== undefined),
  );
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
    { thread, node, permissions, resolvedPermissions, watching },
    { user },
    t,
  ] = await Promise.all([
    getThread(id),
    getViewer(),
    getTranslations("threads.page"),
  ]);
  const page = pageNumber(pageParam);
  const seo = await getSeo(id, page, cursor !== undefined);
  const may = threadMay(resolvedPermissions);
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

      {user && (
        <ThreadTools
          thread={thread}
          watching={watching}
          canWatch={permissions.canWatch}
          may={may}
          mayRemoveCover={mayRemoveCover}
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
        />
      </Suspense>

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
    </PageLayout>
  );
}

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
}: {
  thread: Awaited<ReturnType<typeof getThread>>["thread"];
  highlighted: boolean;
  page: number;
  cursor: string | undefined;
  viewerId: number | null;
  may: ThreadMay;
  selecting: boolean;
  canQuote: boolean;
}) {
  const [
    { items: posts, nextCursor },
    reactionTypes,
    { permissions },
    t,
    format,
  ] = await Promise.all([
    read(
      postsList,
      cursor ? { threadId: thread.id, cursor } : { threadId: thread.id, page },
    ),
    getReactionTypes(),
    getViewer(),
    getTranslations("threads.page"),
    getFormatter(),
  ]);
  // An empty page past the first is a page that does not exist.
  if (posts.length === 0 && page > 1) notFound();
  const [author, relation] = await Promise.all([
    authorsFor(posts.map((post) => post.author)),
    relationsFor(
      viewerId,
      posts.map((post) => post.author.id),
    ),
  ]);
  const picker = permissions.canReact ? pickerTypes(reactionTypes) : [];
  // One signature per member on the page: under their first post.
  const seen = new Set<number>();
  const firstOfAuthor = new Set(
    posts.flatMap((post) => {
      if (seen.has(post.author.id)) return [];
      seen.add(post.author.id);
      return [post.id];
    }),
  );
  const pages = pageCount(thread.lastPost.position);
  const lastPosition = posts.at(-1)?.position;

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
            postbitActions={memberActionsOf(
              author(post.author.id).member,
              relation(post.author.id),
            )}
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
            may={may}
            isFirst={post.id === thread.firstPostId}
            selecting={selecting}
            canQuote={canQuote}
          />
        ))}
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
