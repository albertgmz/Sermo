import { PenLine, Reply, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { react } from "@/app/(main)/actions";
import {
  CoverControls,
  type OwnedCover,
} from "@/app/(main)/threads/[id]/cover-controls";
import { ReplyComposer } from "@/app/(main)/threads/[id]/reply-composer";
import { Art } from "@/components/forum/art";
import { AwardRow } from "@/components/forum/award-icon";
import { ClientIcons } from "@/components/forum/client-icons";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { EmptyState } from "@/components/forum/empty-state";
import { Markdown } from "@/components/forum/markdown";
import { messageActionClass } from "@/components/forum/message-row";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { ReactionButton } from "@/components/forum/reaction-button";
import { ReactionSummary } from "@/components/forum/reaction-summary";
import { RelativeTime } from "@/components/forum/relative-time";
import { ShareButton } from "@/components/forum/share-button";
import { Signature } from "@/components/forum/signature";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserHoverCard } from "@/components/forum/user-hover-card";
import { UserStats } from "@/components/forum/user-stats";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { threadCoverSrc } from "@/lib/appearance";
import {
  getOwnedItems,
  getPosts,
  getReactionTypes,
  getThread,
  type PostView,
  type UserView,
} from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import type { ReactionType } from "@/lib/types";
import { cn } from "@/lib/utils";

const QUIET_ICON =
  "inline-flex size-10 items-center justify-center rounded-md transition-colors hover:text-foreground md:size-7 [&_svg]:size-3.5";
const LABEL = "sr-only sm:not-sr-only";

function PostItem({
  post,
  highlighted,
  signed,
  viewer,
  reactionTypes,
}: {
  post: PostView;
  highlighted: boolean;
  signed: boolean;
  viewer: UserView | null;
  reactionTypes: ReactionType[];
}) {
  const { author } = post;
  // The role badge and the level already say what a derived title would.
  const custom = can(author, "customTitle") ? author.customTitle : null;

  return (
    <article
      id={`post-${post.id}`}
      className="relative isolate grid scroll-mt-4 grid-cols-[auto_minmax(0,1fr)] gap-x-3 p-3 md:gap-x-4 md:p-4"
    >
      <CoverBackdrop
        cover={author.appearance.cover}
        variant={highlighted ? "full" : "header"}
      />
      <UserAvatar user={author} size="lg" className="self-start md:hidden" />
      <UserAvatar
        user={author}
        size="xl"
        className="hidden self-start md:row-span-2 md:block"
      />
      <div className="flex min-w-0 flex-col justify-center gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <UserHoverCard user={author} className="[overflow-wrap:anywhere]" />
          <UserBadges user={author} />
          <AwardRow
            awards={author.awards}
            max={author.awardSlots.desktop}
            maxMobile={author.awardSlots.mobile}
          />
        </div>
        <div className="flex items-center gap-x-3">
          {custom && (
            <p
              title={custom}
              className="min-w-0 truncate text-xs text-muted-foreground"
            >
              {custom}
            </p>
          )}
          <UserStats
            user={author}
            className={cn(
              "shrink-0",
              // On a phone the XP bar gives its room to the title.
              custom && "max-sm:[&_[data-slot=progress]]:hidden",
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
            <ClientIcons client={post.client} />
          </div>
          <div className="flex shrink-0 items-center">
            {highlighted && (
              <span className="mr-1.5 inline-flex items-center gap-1 text-[0.6875rem] font-medium text-primary">
                <Sparkles aria-hidden="true" className="size-3" />
                <span className={LABEL}>Highlighted</span>
              </span>
            )}
            {post.isThreadAuthor && (
              <span className="mr-1.5 inline-flex items-center gap-1 text-[0.6875rem] font-medium">
                <PenLine
                  aria-hidden="true"
                  className="hidden size-3 sm:block"
                />
                <span className="sr-only">Thread </span>Author
              </span>
            )}
            <ShareButton
              href={`/threads/${post.thread.id}#post-${post.id}`}
              className={QUIET_ICON}
            />
            <Link
              href={`#post-${post.id}`}
              className="inline-flex h-10 min-w-10 items-center justify-center px-1.5 tabular-nums hover:text-foreground md:h-7 md:min-w-7"
            >
              #{post.number}
            </Link>
          </div>
        </div>

        <Markdown className="md:mt-1">{post.body}</Markdown>

        <div className="mt-2 -mx-2 flex items-center justify-end gap-1">
          <ReactionButton
            action={react.bind(null, "post", post.id)}
            total={post.reactions.total}
            viewerTypeId={post.reactions.viewerTypeId}
            types={reactionTypes}
            viewerId={viewer?.id ?? null}
            authorId={post.authorId}
          />
          <Link href="#reply" className={messageActionClass}>
            <Reply />
            Reply
          </Link>
        </div>

        <ReactionSummary reactions={post.reactions} className="-ml-1" />

        {signed && author.signature && (
          <Signature className="mt-2 border-t pt-2">
            {author.signature}
          </Signature>
        )}
      </div>
    </article>
  );
}

export async function generateMetadata({
  params,
}: PageProps<"/threads/[id]">): Promise<Metadata> {
  const thread = await getThread(Number((await params).id));
  return {
    title: `${thread?.prefix ? `${thread.prefix.label} ` : ""}${thread?.title ?? "Thread"} - forum/ui`,
  };
}

export default async function ThreadPage({
  params,
}: PageProps<"/threads/[id]">) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const viewer = await getCurrentUser();
  const [thread, posts, reactionTypes] = await Promise.all([
    getThread(id),
    getPosts(id, viewer?.id ?? null),
    getReactionTypes(),
  ]);
  if (!thread) notFound();

  const own = viewer?.id === thread.authorId;
  const staff = viewer !== null && viewer.role !== "member";
  const covers: OwnedCover[] =
    own && viewer
      ? (await getOwnedItems(viewer.id)).threadCover.flatMap((item) =>
          item.effect.type === "threadCover"
            ? [
                {
                  itemId: item.id,
                  name: item.name.replace(/ thread cover$/, ""),
                  src: threadCoverSrc(item.effect.cover),
                  quantity: item.quantity,
                },
              ]
            : [],
        )
      : [];
  // One signature per member on the page: under their first post.
  const signedPostIds = new Set(
    posts
      .filter(
        (post, index) =>
          can(post.author, "signature") &&
          posts.findIndex((p) => p.authorId === post.authorId) === index,
      )
      .map((post) => post.id),
  );

  return (
    <PageLayout className="pt-2">
      <header
        className={cn(
          thread.cover && "relative isolate overflow-hidden rounded-lg border",
        )}
      >
        {thread.cover && (
          <Art
            src={threadCoverSrc(thread.cover)}
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
              { label: "Home", href: "/" },
              {
                label: thread.forum.categoryTitle,
                href: `/forums?tab=${thread.forum.tab}`,
              },
              {
                label: thread.forum.title,
                href: `/forums/${thread.forum.id}`,
              },
            ]}
          />
          <h1 className="mt-1 text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
            {thread.prefix && (
              <PrefixTag
                prefix={thread.prefix}
                className="mr-2 align-[0.1875rem]"
              />
            )}
            {thread.title}
          </h1>
        </div>
      </header>
      {(own || (staff && thread.cover)) && (
        <div className="mt-3">
          <CoverControls
            threadId={thread.id}
            hasCover={thread.cover !== null}
            own={own}
            covers={covers}
          />
        </div>
      )}

      <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border bg-card">
        {posts.map((post) => (
          <PostItem
            key={post.id}
            post={post}
            highlighted={thread.highlighted && post.number === 1}
            signed={signedPostIds.has(post.id)}
            viewer={viewer}
            reactionTypes={reactionTypes}
          />
        ))}
      </div>

      <section id="reply" aria-label="Reply" className="mt-4 scroll-mt-4">
        {viewer ? (
          <ReplyComposer threadId={thread.id} />
        ) : (
          <div className="rounded-lg border bg-card">
            <EmptyState
              title="Log in to reply"
              description="Join the conversation with your account."
            >
              <Link
                href="/login"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "h-10 px-4",
                )}
              >
                Log in
              </Link>
              <Link
                href="/register"
                className={cn(buttonVariants(), "h-10 px-4")}
              >
                Create Account
              </Link>
            </EmptyState>
          </div>
        )}
      </section>
    </PageLayout>
  );
}
