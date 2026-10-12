import { Eye, MessageCircle, MessagesSquare, Pin, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Art } from "@/components/forum/art";
import { EmptyState } from "@/components/forum/empty-state";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PrefixTag } from "@/components/forum/prefix-tag";
import {
  LoadingRegion,
  TabsSkeleton,
  ThreadRowSkeleton,
} from "@/components/forum/skeletons";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import {
  getForum,
  getPrefixes,
  getThreads,
  type PrefixEntry,
  type ThreadView,
} from "@/lib/db";
import { formatCompact } from "@/lib/format";
import { getCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

const filterClass =
  "inline-flex h-10 shrink-0 items-center rounded-md px-1 transition-opacity md:h-7";

function PrefixFilter({
  id,
  prefixes,
  active,
}: {
  id: number;
  prefixes: PrefixEntry[];
  active: PrefixEntry | undefined;
}) {
  const t = useTranslations("forums.forum");
  return (
    <nav
      aria-label={t("aria.prefixFilter")}
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
        {t("allThreads")}
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
  const t = useTranslations("forums.forum");
  const format = useFormatter();
  const now = useNow();
  return (
    <li
      className={cn(
        "relative isolate flex items-center gap-3 px-3 py-2.5 md:px-4",
        thread.highlighted &&
          "bg-primary/5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
      )}
    >
      {thread.coverPicture && (
        <Art
          category="threadCovers"
          src={thread.coverPicture.url}
          className="absolute inset-y-0 right-0 -z-10 w-2/3 opacity-25 [mask-image:linear-gradient(to_left,black,transparent)] md:w-1/2"
        />
      )}
      <UserAvatar
        user={thread.author.member}
        size="lg"
        className="relative z-10"
      />
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
              aria-label={t("aria.pinned")}
              className="mt-0.5 size-3.5 shrink-0 text-primary"
            />
          )}
          <span className="line-clamp-2 [overflow-wrap:anywhere]">
            {thread.prefix && (
              <PrefixTag
                prefix={thread.prefix}
                className="mr-1.5 align-(--prefix-offset)"
              />
            )}
            {thread.title}
            {thread.highlighted && (
              <span className="sr-only">{t("aria.highlighted")}</span>
            )}
          </span>
        </ThreadHoverCard>
        <p className="truncate text-xs text-muted-foreground">
          {t.rich("created", {
            author: () => (
              <UserLink user={thread.author.member} className="relative z-10" />
            ),
            time: format.relativeTime(new Date(thread.createdAt), now),
          })}
        </p>
      </div>
      <dl className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground tabular-nums sm:flex-row sm:gap-0">
        <div className="flex items-center gap-1 sm:w-16 sm:justify-end">
          <dt>
            <MessageCircle aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{t("aria.replies")}</span>
          </dt>
          <dd>{formatCompact(thread.replyCount)}</dd>
        </div>
        <div className="flex items-center gap-1 sm:w-16 sm:justify-end">
          <dt>
            <Eye aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{t("aria.views")}</span>
          </dt>
          <dd>{formatCompact(thread.views)}</dd>
        </div>
      </dl>
      <p className="hidden w-52 shrink-0 truncate text-right text-xs text-muted-foreground md:block">
        {t.rich("lastPost", {
          time: format.relativeTime(new Date(thread.lastPost.createdAt), now),
          author: () => (
            <UserLink
              user={thread.lastPost.author.member}
              className="relative z-10"
            />
          ),
        })}
      </p>
    </li>
  );
}

export async function generateMetadata({
  params,
}: PageProps<"/forums/[id]">): Promise<Metadata> {
  const forum = await getForum(Number((await params).id));
  const t = await getTranslations("forums.forum");
  return {
    title: t("metaTitle", { title: forum?.title ?? t("metaTitleFallback") }),
  };
}

export default async function ForumPage({
  params,
  searchParams,
}: PageProps<"/forums/[id]">) {
  const [{ id }, { prefix: param }] = await Promise.all([params, searchParams]);
  const forum = await getForum(Number(id));
  if (!forum) notFound();
  const user = await getCurrentUser();
  const t = await getTranslations("forums.forum");

  const newThread = user && (
    <Link
      href={`/forums/${forum.id}/new`}
      className={cn(buttonVariants(), "h-10 px-3 md:h-8")}
    >
      <Plus />
      {t("newThread")}
    </Link>
  );

  return (
    <PageLayout className="pt-2">
      <PageBreadcrumb
        items={[
          { label: t("home"), href: "/" },
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

      <Suspense
        fallback={
          <LoadingRegion label={t("aria.loadingThreads")}>
            <TabsSkeleton />
            <div className="mt-1 divide-y overflow-hidden rounded-lg border bg-card">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((row) => (
                <ThreadRowSkeleton key={row} />
              ))}
            </div>
          </LoadingRegion>
        }
      >
        <ForumThreads
          forumId={forum.id}
          param={param}
          user={user}
          newThread={newThread}
        />
      </Suspense>
    </PageLayout>
  );
}

async function ForumThreads({
  forumId,
  param,
  user,
  newThread,
}: {
  forumId: number;
  param: string | string[] | undefined;
  user: Awaited<ReturnType<typeof getCurrentUser>>;
  newThread: React.ReactNode;
}) {
  const all = await getThreads(forumId);
  const t = await getTranslations("forums.forum");
  const used = new Set(all.flatMap((thread) => thread.prefix?.id ?? []));
  const prefixes = (await getPrefixes())
    .filter((prefix) => used.has(prefix.id))
    .toSorted((a, b) => a.id - b.id);
  const active = prefixes.find((prefix) => prefix.key === param);
  const threads = active
    ? await getThreads(forumId, { prefixId: active.id })
    : all;

  return (
    <>
      {prefixes.length > 0 && (
        <PrefixFilter id={forumId} prefixes={prefixes} active={active} />
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
            title={t("empty")}
            description={
              user ? t("emptyMemberDescription") : t("emptyGuestDescription")
            }
          >
            {newThread}
          </EmptyState>
        )}
      </div>
    </>
  );
}
