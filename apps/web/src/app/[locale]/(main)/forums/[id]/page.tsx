import {
  nodesGet,
  nodesList,
  threadPrefixesList,
  threadsList,
} from "@sermo/core/contracts";
import {
  Eye,
  Lock,
  MessageCircle,
  MessagesSquare,
  Pin,
  Plus,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import { ForumWatch } from "@/app/[locale]/(main)/forums/[id]/forum-watch";
import { Art } from "@/components/forum/art";
import { EmptyState } from "@/components/forum/empty-state";
import { ForumCard } from "@/components/forum/forum-card";
import { JsonLd } from "@/components/forum/json-ld";
import { LoadMore } from "@/components/forum/load-more";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PrefixTag } from "@/components/forum/prefix-tag";
import {
  LoadingRegion,
  TabsSkeleton,
  ThreadRowSkeleton,
} from "@/components/forum/skeletons";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UnreadDot } from "@/components/forum/unread-dot";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { formatCompact } from "@/lib/format";
import { read } from "@/lib/sermo/client";
import { childrenByParent, forumCard, nodeMembers } from "@/lib/sermo/forums";
import { parsePageId } from "@/lib/sermo/ids";
import { membersFor } from "@/lib/sermo/members";
import { copyOf, seoMetadata } from "@/lib/sermo/seo";
import { getViewer } from "@/lib/sermo/session";
import {
  type ApiThread,
  prefixView,
  threadCard,
  threadMembers,
} from "@/lib/sermo/threads";
import type { PrefixView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

const filterClass =
  "inline-flex h-10 shrink-0 items-center rounded-md px-1 transition-opacity md:h-7";

// The node is asked once for the metadata and the page.
const getNode = cache((nodeId: number) => read(nodesGet, { nodeId }));

function nodeIdOf(raw: string) {
  const id = parsePageId(raw);
  if (id === null) notFound();
  return id;
}

function PrefixFilter({
  id,
  prefixes,
  active,
}: {
  id: number;
  prefixes: PrefixView[];
  active: number | undefined;
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
        aria-current={active === undefined ? "true" : undefined}
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
          href={`/forums/${id}?prefix=${prefix.id}`}
          scroll={false}
          aria-current={prefix.id === active ? "true" : undefined}
          className={cn(
            filterClass,
            active !== undefined &&
              "opacity-70 hover:opacity-100 aria-[current=true]:opacity-100",
          )}
        >
          <PrefixTag prefix={prefix} />
        </Link>
      ))}
    </nav>
  );
}

function ThreadRow({
  thread,
  member,
  highlighted,
}: {
  thread: ApiThread;
  member: Awaited<ReturnType<typeof membersFor>>;
  highlighted: boolean;
}) {
  const t = useTranslations("forums.forum");
  const format = useFormatter();
  const now = useNow();
  const card = threadCard(thread, member);
  return (
    <li
      className={cn(
        "relative isolate flex items-center gap-3 px-3 py-2.5 md:px-4",
        highlighted &&
          "bg-primary/5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
      )}
    >
      {card.coverPicture && (
        <Art
          category="threadCovers"
          src={card.coverPicture.url}
          className="absolute inset-y-0 right-0 -z-10 w-2/3 opacity-25 [mask-image:linear-gradient(to_left,black,transparent)] md:w-1/2"
        />
      )}
      <UserAvatar
        user={card.author.member}
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
          thread={card}
          className={cn(
            "relative z-10 flex w-fit max-w-full items-start gap-1.5 text-sm hover:underline",
            thread.isUnread ? "font-bold" : "font-medium",
          )}
        >
          {thread.isUnread && <UnreadDot className="mt-1.5" />}
          {thread.isSticky && (
            <Pin
              aria-label={t("aria.pinned")}
              className="mt-0.5 size-3.5 shrink-0 text-primary"
            />
          )}
          {thread.isLocked && (
            <Lock
              aria-label={t("aria.locked")}
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            />
          )}
          <span className="line-clamp-2 [overflow-wrap:anywhere]">
            {card.prefix && (
              <PrefixTag
                prefix={card.prefix}
                className="mr-1.5 align-(--prefix-offset)"
              />
            )}
            {card.title}
            {highlighted && (
              <span className="sr-only">{t("aria.highlighted")}</span>
            )}
          </span>
        </ThreadHoverCard>
        <p className="truncate text-xs text-muted-foreground">
          {t.rich("created", {
            author: () => (
              <UserLink user={card.author.member} className="relative z-10" />
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
          <dd>{formatCompact(card.replyCount)}</dd>
        </div>
        <div className="flex items-center gap-1 sm:w-16 sm:justify-end">
          <dt>
            <Eye aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{t("aria.views")}</span>
          </dt>
          <dd>{formatCompact(card.views)}</dd>
        </div>
      </dl>
      <p className="hidden w-52 shrink-0 truncate text-right text-xs text-muted-foreground md:block">
        {t.rich("lastPost", {
          time: format.relativeTime(new Date(card.lastPost.createdAt), now),
          author: () => (
            <UserLink
              user={card.lastPost.author.member}
              className="relative z-10"
            />
          ),
        })}
      </p>
    </li>
  );
}

// The backend has one address for a forum; a list continued by cursor or narrowed by prefix is a
// copy of it.
async function seoOf(
  id: string,
  searchParams: PageProps<"/[locale]/forums/[id]">["searchParams"],
) {
  const [{ seo }, { prefix, cursor }] = await Promise.all([
    getNode(nodeIdOf(id)),
    searchParams,
  ]);
  return prefix !== undefined || cursor !== undefined ? copyOf(seo) : seo;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/[locale]/forums/[id]">): Promise<Metadata> {
  return seoMetadata(await seoOf((await params).id, searchParams));
}

export default async function ForumPage({
  params,
  searchParams,
}: PageProps<"/[locale]/forums/[id]">) {
  const [{ id: raw }, { prefix, cursor }] = await Promise.all([
    params,
    searchParams,
  ]);
  const { node, breadcrumbs, watching } = await getNode(nodeIdOf(raw));
  const seo = await seoOf(raw, searchParams);
  const [{ user }, t] = await Promise.all([
    getViewer(),
    getTranslations("forums.forum"),
  ]);

  const isForum = node.type === "forum";
  const newThread = isForum && node.permissions.canPost && (
    <Link
      href={`/forums/${node.id}/new`}
      className={cn(buttonVariants(), "h-10 px-3 md:h-8")}
    >
      <Plus />
      {t("newThread")}
    </Link>
  );
  const trail =
    breadcrumbs.at(-1)?.id === node.id ? breadcrumbs : [...breadcrumbs, node];

  return (
    <PageLayout className="pt-2">
      <JsonLd items={seo.jsonLd} />
      <PageBreadcrumb
        items={[
          { label: t("home"), href: "/" },
          ...trail.map((crumb, index) => ({
            label: crumb.title,
            href:
              index === trail.length - 1 ? undefined : `/forums/${crumb.id}`,
          })),
        ]}
      />
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {node.title}
          </h1>
          {node.description && (
            <p className="mt-1 max-w-2xl text-sm text-pretty text-muted-foreground">
              {node.description}
            </p>
          )}
        </div>
        {newThread}
      </div>
      {user && isForum && (
        <div className="mt-3">
          <ForumWatch nodeId={node.id} watching={watching} />
        </div>
      )}

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
        {isForum ? (
          <ForumThreads
            nodeId={node.id}
            prefix={typeof prefix === "string" ? prefix : undefined}
            cursor={typeof cursor === "string" ? cursor : undefined}
            newThread={newThread}
            signedIn={user !== null}
          />
        ) : (
          <CategoryForums nodeId={node.id} />
        )}
      </Suspense>
    </PageLayout>
  );
}

// A category holds no threads: its forums are what the page lists.
async function CategoryForums({ nodeId }: { nodeId: number }) {
  const [{ items: nodes }, t] = await Promise.all([
    read(nodesList, {}),
    getTranslations("forums.forum"),
  ]);
  const childrenOf = childrenByParent(nodes);
  const forums = childrenOf(nodeId);
  const member = await membersFor(nodeMembers(nodes));
  if (forums.length === 0) {
    return (
      <div className="mt-4 rounded-lg border bg-card">
        <EmptyState
          icon={MessagesSquare}
          title={t("emptyCategory")}
          description={t("emptyCategoryDescription")}
        />
      </div>
    );
  }
  return (
    <ul className="mt-4 grid gap-2 md:grid-cols-2">
      {forums.map((forum) => (
        <ForumCard
          key={forum.id}
          forum={forumCard(forum, childrenOf(forum.id), member)}
          className="md:last:odd:col-span-2"
        />
      ))}
    </ul>
  );
}

async function ForumThreads({
  nodeId,
  prefix,
  cursor,
  newThread,
  signedIn,
}: {
  nodeId: number;
  prefix: string | undefined;
  cursor: string | undefined;
  newThread: React.ReactNode;
  signedIn: boolean;
}) {
  const prefixId = /^[1-9]\d*$/.test(prefix ?? "") ? Number(prefix) : undefined;
  const [list, { items: allPrefixes }, t] = await Promise.all([
    read(threadsList, { nodeId, prefixId, cursor }),
    read(threadPrefixesList, {}),
    getTranslations("forums.forum"),
  ]);
  const threads = [...list.sticky, ...list.items];
  const member = await membersFor(threads.flatMap(threadMembers));
  const prefixes = allPrefixes
    .filter((entry) => entry.isActive)
    .flatMap((entry) => prefixView(entry) ?? []);
  const now = Date.now();
  const next = new URLSearchParams();
  if (prefixId !== undefined) next.set("prefix", String(prefixId));
  if (list.nextCursor) next.set("cursor", list.nextCursor);

  return (
    <>
      {prefixes.length > 0 && (
        <PrefixFilter id={nodeId} prefixes={prefixes} active={prefixId} />
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
              <ThreadRow
                key={thread.id}
                thread={thread}
                member={member}
                highlighted={
                  thread.highlightedUntil !== null &&
                  Date.parse(thread.highlightedUntil) > now
                }
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={MessagesSquare}
            title={t("empty")}
            description={
              newThread
                ? t("emptyMemberDescription")
                : signedIn
                  ? undefined
                  : t("emptyGuestDescription")
            }
          >
            {newThread}
          </EmptyState>
        )}
      </div>
      {list.nextCursor && (
        <LoadMore href={`/forums/${nodeId}?${next}`} className="mt-3">
          {t("nextPage")}
        </LoadMore>
      )}
    </>
  );
}
