import { Eye, MessageCircle, MessagesSquare, Pin, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Art } from "@/components/forum/art";
import { EmptyState } from "@/components/forum/empty-state";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserHoverCard } from "@/components/forum/user-hover-card";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { threadCoverSrc } from "@/lib/appearance";
import { getForum, getThreads, type ThreadView } from "@/lib/db";
import { formatCompact, formatRelativeTime } from "@/lib/format";
import { getCurrentUser } from "@/lib/session";
import type { Prefix } from "@/lib/types";
import { cn } from "@/lib/utils";

const filterClass =
  "inline-flex h-10 shrink-0 items-center rounded-md px-1 transition-opacity md:h-7";

function PrefixFilter({
  id,
  prefixes,
  active,
}: {
  id: number;
  prefixes: Prefix[];
  active: Prefix | undefined;
}) {
  return (
    <nav
      aria-label="Filter by prefix"
      className="-mx-1 mt-3 flex overflow-x-auto [scrollbar-width:none]"
    >
      <Link
        href={`/forums/${id}`}
        scroll={false}
        aria-current={active ? undefined : "true"}
        className={cn(
          filterClass,
          "px-2 text-xs font-medium text-muted-foreground hover:text-foreground aria-[current=true]:text-foreground",
        )}
      >
        All threads
      </Link>
      {prefixes.map((prefix) => (
        <Link
          key={prefix.id}
          href={`/forums/${id}?prefix=${prefix.key}`}
          scroll={false}
          aria-current={prefix.id === active?.id ? "true" : undefined}
          className={cn(
            filterClass,
            active &&
              "opacity-70 hover:opacity-100 aria-[current=true]:opacity-100",
          )}
        >
          <PrefixTag prefix={prefix} />
        </Link>
      ))}
    </nav>
  );
}

function ThreadRow({ thread }: { thread: ThreadView }) {
  return (
    <li
      className={cn(
        "relative isolate flex items-center gap-3 px-3 py-2.5 md:px-4",
        thread.highlighted &&
          "bg-primary/5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
      )}
    >
      {thread.cover && (
        <Art
          src={threadCoverSrc(thread.cover)}
          className="absolute inset-y-0 right-0 -z-10 w-2/3 opacity-25 [mask-image:linear-gradient(to_left,black,transparent)] md:w-1/2"
        />
      )}
      <UserAvatar user={thread.author} size="lg" className="relative z-10" />
      <div className="min-w-0 flex-1">
        <Link
          href={`/threads/${thread.id}`}
          aria-hidden="true"
          tabIndex={-1}
          className="absolute inset-0"
        />
        <ThreadHoverCard
          thread={thread}
          className="relative z-10 flex w-fit max-w-full items-start gap-1.5 text-sm font-medium hover:underline"
        >
          {thread.pinned && (
            <Pin
              aria-label="Pinned"
              className="mt-0.5 size-3.5 shrink-0 text-primary"
            />
          )}
          <span className="line-clamp-2 [overflow-wrap:anywhere]">
            {thread.prefix && (
              <PrefixTag
                prefix={thread.prefix}
                className="mr-1.5 align-[0.0625rem]"
              />
            )}
            {thread.title}
            {thread.highlighted && (
              <span className="sr-only"> (highlighted)</span>
            )}
          </span>
        </ThreadHoverCard>
        <p className="truncate text-xs text-muted-foreground">
          <UserHoverCard user={thread.author} className="relative z-10" /> ·{" "}
          {formatRelativeTime(thread.createdAt)}
        </p>
      </div>
      <dl className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground tabular-nums sm:flex-row sm:gap-0">
        <div className="flex items-center gap-1 sm:w-16 sm:justify-end">
          <dt>
            <MessageCircle aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Replies</span>
          </dt>
          <dd>{formatCompact(thread.replyCount)}</dd>
        </div>
        <div className="flex items-center gap-1 sm:w-16 sm:justify-end">
          <dt>
            <Eye aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Views</span>
          </dt>
          <dd>{formatCompact(thread.views)}</dd>
        </div>
      </dl>
      <p className="hidden w-52 shrink-0 truncate text-right text-xs text-muted-foreground md:block">
        {formatRelativeTime(thread.lastPost.createdAt)} ·{" "}
        <UserHoverCard
          user={thread.lastPost.author}
          className="relative z-10"
        />
      </p>
    </li>
  );
}

export async function generateMetadata({
  params,
}: PageProps<"/forums/[id]">): Promise<Metadata> {
  const forum = await getForum(Number((await params).id));
  return { title: `${forum?.title ?? "Forum"} - forum/ui` };
}

export default async function ForumPage({
  params,
  searchParams,
}: PageProps<"/forums/[id]">) {
  const [{ id }, { prefix: param }] = await Promise.all([params, searchParams]);
  const forum = await getForum(Number(id));
  if (!forum) notFound();
  const [user, all] = await Promise.all([
    getCurrentUser(),
    getThreads(forum.id),
  ]);
  const prefixes = all
    .flatMap((thread) => thread.prefix ?? [])
    .filter((prefix, index, list) => list.indexOf(prefix) === index)
    .toSorted((a, b) => a.id - b.id);
  const active = prefixes.find((prefix) => prefix.key === param);
  const threads = active
    ? await getThreads(forum.id, { prefixId: active.id })
    : all;

  const newThread = user && (
    <Link
      href={`/forums/${forum.id}/new`}
      className={cn(buttonVariants(), "h-10 px-3 md:h-8")}
    >
      <Plus />
      New thread
    </Link>
  );

  return (
    <PageLayout className="pt-2">
      <PageBreadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: forum.categoryTitle, href: `/forums?tab=${forum.tab}` },
          { label: forum.title },
        ]}
      />
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {forum.title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-pretty text-muted-foreground">
            {forum.description}
          </p>
        </div>
        {newThread}
      </div>

      {prefixes.length > 0 && (
        <PrefixFilter id={forum.id} prefixes={prefixes} active={active} />
      )}

      <div
        className={cn(
          "overflow-hidden rounded-lg border bg-card",
          prefixes.length > 0 ? "mt-1" : "mt-4",
        )}
      >
        {threads.length > 0 ? (
          <ul className="divide-y divide-border">
            {threads.map((thread) => (
              <ThreadRow key={thread.id} thread={thread} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={MessagesSquare}
            title="No threads yet"
            description={
              user
                ? "Be the first to start a discussion in this forum."
                : "Log in to start the first discussion in this forum."
            }
          >
            {newThread}
          </EmptyState>
        )}
      </div>
    </PageLayout>
  );
}
