import { postsList, threadsGet } from "@sermo/core/contracts";
import {
  Hourglass,
  Lock,
  Paperclip,
  PenLine,
  Reply,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import { react } from "@/app/(main)/actions";
import { MarkRead } from "@/app/(main)/threads/[id]/mark-read";
import { pageCount, threadHref } from "@/app/(main)/threads/[id]/pages";
import { ReplyComposer } from "@/app/(main)/threads/[id]/reply-composer";
import { Art } from "@/components/forum/art";
import { AwardRow } from "@/components/forum/award-icon";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { EmptyState } from "@/components/forum/empty-state";
import { HtmlContent } from "@/components/forum/html-content";
import { messageActionClass } from "@/components/forum/message-row";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { ReactionButton } from "@/components/forum/reaction-button";
import { ReactionSummary } from "@/components/forum/reaction-summary";
import { loadReactionUsers } from "@/components/forum/reaction-users-action";
import { RelativeTime } from "@/components/forum/relative-time";
import { ShareButton } from "@/components/forum/share-button";
import { SignatureHtml } from "@/components/forum/signature-html";
import { LoadingRegion, PostSkeleton } from "@/components/forum/skeletons";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { UserStats } from "@/components/forum/user-stats";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import type { Level } from "@/lib/levels";
import { read } from "@/lib/sermo/client";
import { authorsFor } from "@/lib/sermo/members";
import {
  getReactionTypes,
  pickerTypes,
  reactionsView,
} from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";
import { type ApiPost, prefixView } from "@/lib/sermo/threads";
import type { AuthorView } from "@/lib/sermo/views";
import type { ReactionType } from "@/lib/types";
import { cn } from "@/lib/utils";

const QUIET_ICON =
  "inline-flex size-10 items-center justify-center rounded-md transition-colors hover:text-foreground md:size-7 [&_svg]:size-3.5";
const LABEL = "sr-only sm:not-sr-only";

// The thread is asked once for the metadata and the page: asking counts a view.
const getThread = cache((threadId: number) => read(threadsGet, { threadId }));

function threadIdOf(raw: string) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) notFound();
  return id;
}

// The bounds of the level come from the backend; only the bar's fill is worked out here.
function levelOf(author: AuthorView): Level {
  const span = author.nextLevelXp - author.currentLevelXp;
  return {
    level: author.member.level,
    xp: author.xp,
    currentLevelXp: author.currentLevelXp,
    nextLevelXp: author.nextLevelXp,
    progress:
      span > 0
        ? Math.min(1, Math.max(0, (author.xp - author.currentLevelXp) / span))
        : 0,
  };
}

// The attachments carry no name of their own: the last part of the address is the best there is.
function fileName(url: string, fileId: number) {
  const last = url.split("?")[0].split("/").at(-1);
  try {
    return last ? decodeURIComponent(last) : `#${fileId}`;
  } catch {
    return last || `#${fileId}`;
  }
}

function PostNote({
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

function PostItem({
  post,
  author,
  byThreadAuthor,
  noteState,
  highlighted,
  signed,
  viewerId,
  picker,
  reactionTypes,
}: {
  post: ApiPost;
  author: AuthorView;
  byThreadAuthor: boolean;
  // Whether the post says it is waiting or deleted; the thread says so already for its own state.
  noteState: boolean;
  highlighted: boolean;
  signed: boolean;
  viewerId: number | null;
  // What the picker offers; none when the viewer may not react to this post.
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
}) {
  const t = useTranslations("threads.page");
  const format = useFormatter();
  const { member } = author;
  const number = post.position + 1;
  const href = threadHref(post.threadId, post.position, post.id);

  return (
    <article
      id={`post-${post.id}`}
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
              level: levelOf(author),
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
            <RelativeTime
              date={post.createdAt}
              className="truncate md:hidden"
            />
            <time
              dateTime={post.createdAt}
              className="hidden truncate md:inline"
            >
              {formatDateTime(post.createdAt)}
            </time>
            {post.editedAt && (
              <span className="shrink-0">
                {t.rich("edited", {
                  time: () => <RelativeTime date={post.editedAt ?? ""} />,
                })}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center">
            {highlighted && (
              <span className="mr-1.5 inline-flex items-center gap-1 text-(length:--text-caption) font-medium text-primary">
                <Sparkles aria-hidden="true" className="size-3" />
                <span className={LABEL}>{t("highlightedLabel")}</span>
              </span>
            )}
            {byThreadAuthor && (
              <span className="mr-1.5 inline-flex items-center gap-1 text-(length:--text-caption) font-medium">
                <PenLine
                  aria-hidden="true"
                  className="hidden size-3 sm:block"
                />
                {t.rich("authorLabel", {
                  hidden: (chunks) => <span className="sr-only">{chunks}</span>,
                })}
              </span>
            )}
            <ShareButton href={href} className={QUIET_ICON} />
            <Link
              href={`#post-${post.id}`}
              className="inline-flex h-10 min-w-10 items-center justify-center px-1.5 tabular-nums hover:text-foreground md:h-7 md:min-w-7"
            >
              {t("postNumber", { number })}
            </Link>
          </div>
        </div>

        {noteState && post.state === "moderated" && (
          <PostNote icon={Hourglass}>{t("awaitingApproval")}</PostNote>
        )}
        {noteState && post.state === "deleted" && (
          <PostNote icon={Trash2}>{t("deleted")}</PostNote>
        )}

        <HtmlContent className="md:mt-1">{post.bodyHtml}</HtmlContent>

        {post.attachments.length > 0 && (
          <ul
            aria-label={t("aria.attachments")}
            className="mt-3 flex flex-wrap gap-2"
          >
            {post.attachments.map((file) => (
              <li key={file.fileId} className="min-w-0 max-w-full">
                <a
                  href={file.url}
                  className="flex min-h-10 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm hover:bg-muted md:min-h-8"
                >
                  <Paperclip
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="truncate">
                    {fileName(file.url, file.fileId)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatBytes(format, file.byteSize)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 -mx-2 flex items-center justify-end gap-1">
          <ReactionButton
            action={react.bind(null, "post", post.id)}
            total={post.reactions.total}
            viewerTypeId={post.reactions.mine}
            types={picker}
            viewerId={viewerId}
            authorId={post.author.id}
          />
          <Link href="#reply" className={messageActionClass}>
            <Reply />
            {t("reply")}
          </Link>
        </div>

        <ReactionSummary
          reactions={reactionsView(post.reactions, reactionTypes)}
          loadUsers={loadReactionUsers.bind(null, "post", post.id)}
          className="-ml-1"
        />

        {signed && author.signatureHtml && (
          <SignatureHtml className="mt-2 border-t pt-2">
            {author.signatureHtml}
          </SignatureHtml>
        )}
      </div>
    </article>
  );
}

function formatBytes(format: ReturnType<typeof useFormatter>, bytes: number) {
  const [unit, size] =
    bytes < 1024
      ? (["byte", bytes] as const)
      : bytes < 1024 * 1024
        ? (["kilobyte", bytes / 1024] as const)
        : (["megabyte", bytes / (1024 * 1024)] as const);
  return format.number(size, {
    style: "unit",
    unit,
    maximumFractionDigits: 1,
  });
}

export async function generateMetadata({
  params,
}: PageProps<"/threads/[id]">): Promise<Metadata> {
  const { thread } = await getThread(threadIdOf((await params).id));
  const t = await getTranslations("threads.page");
  return {
    title: t("metaTitle", {
      hasPrefix: String(Boolean(thread.prefix)),
      prefix: thread.prefix?.label ?? "",
      title: thread.title,
    }),
  };
}

export default async function ThreadPage({
  params,
  searchParams,
}: PageProps<"/threads/[id]">) {
  const [{ id: raw }, { page: pageParam, cursor }] = await Promise.all([
    params,
    searchParams,
  ]);
  const id = threadIdOf(raw);
  const [{ thread, node, permissions }, { user }, t] = await Promise.all([
    getThread(id),
    getViewer(),
    getTranslations("threads.page"),
  ]);
  const page = Math.max(1, Math.floor(Number(pageParam)) || 1);
  const prefix = prefixView(thread.prefix);
  const highlighted =
    thread.highlightedUntil !== null &&
    Date.parse(thread.highlightedUntil) > Date.now();

  return (
    <PageLayout className="pt-2">
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
            <ReplyComposer threadId={thread.id} />
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

function pageHref(threadId: number, page: number, cursor?: string) {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return `/threads/${threadId}${query ? `?${query}` : ""}`;
}

async function ThreadPosts({
  thread,
  highlighted,
  page,
  cursor,
  viewerId,
}: {
  thread: Awaited<ReturnType<typeof getThread>>["thread"];
  highlighted: boolean;
  page: number;
  cursor: string | undefined;
  viewerId: number | null;
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
  const author = await authorsFor(posts.map((post) => post.author));
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
                href={pageHref(thread.id, page - 1)}
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
