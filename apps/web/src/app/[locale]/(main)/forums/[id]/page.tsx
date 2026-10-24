import { nodesGet, nodesList, threadPrefixesList } from "@sermo/core/contracts";
import { MessagesSquare, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import { ForumMarkRead } from "@/app/[locale]/(main)/forums/[id]/forum-mark-read";
import { ForumWatch } from "@/app/[locale]/(main)/forums/[id]/forum-watch";
import { moreThreads } from "@/app/[locale]/(main)/forums/[id]/more-threads";
import { threadsPage } from "@/app/[locale]/(main)/forums/[id]/thread-page";
import { batchUpdateThreadsAction } from "@/app/[locale]/(main)/forums/actions";
import { forumsOtherThan } from "@/app/[locale]/(main)/threads/[id]/moderation";
import { EmptyState } from "@/components/forum/empty-state";
import { bannerOf } from "@/components/forum/forum-banner";
import { ForumCardGrid } from "@/components/forum/forum-card-grid";
import { JsonLd } from "@/components/forum/json-ld";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PagedList } from "@/components/forum/paged-list";
import { PrefixTag } from "@/components/forum/prefix-tag";
import {
  LoadingRegion,
  TabsSkeleton,
  ThreadRowSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { ThreadBatch } from "@/components/staff/thread-batch";
import { batchActionsFor } from "@/components/staff/thread-batch-state";
import { buttonVariants } from "@/components/ui/button";
import { widgetAreas, widgetAside } from "@/components/widgets/widget-area";
import { pagesParam } from "@/lib/list-pages";
import { canonicalPathOf } from "@/lib/sermo/addresses";
import { read } from "@/lib/sermo/client";
import { cardMembers, childrenByParent, nodeMembers } from "@/lib/sermo/forums";
import { parsePageId } from "@/lib/sermo/ids";
import { membersFor } from "@/lib/sermo/members";
import { copyOf, seoMetadata } from "@/lib/sermo/seo";
import { getViewer } from "@/lib/sermo/session";
import { publicHead } from "@/lib/sermo/share";
import { activePrefixViews } from "@/lib/sermo/threads";
import { unreadForums } from "@/lib/sermo/unread-forums";
import type { PrefixView } from "@/lib/sermo/views";
import { getWidgets } from "@/lib/sermo/widgets";
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

// The backend has one address for a forum; a list continued by cursor or narrowed by prefix is a
// copy of it.
async function seoOf(
  id: string,
  searchParams: PageProps<"/[locale]/forums/[id]">["searchParams"],
) {
  const [{ seo }, { prefix, cursor, pages }] = await Promise.all([
    getNode(nodeIdOf(id)),
    searchParams,
  ]);
  return prefix !== undefined || cursor !== undefined || pages !== undefined
    ? copyOf(seo)
    : seo;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/[locale]/forums/[id]">): Promise<Metadata> {
  const { id } = await params;
  const head = seoMetadata(await seoOf(id, searchParams));
  // Shared, with its own feed, only when guests may open it (the backend indexes it).
  const { node, seo } = await getNode(nodeIdOf(id));
  if (seo.robots !== "index,follow") return head;
  return publicHead(head, {
    title: node.title,
    markdown: true,
    card: { kind: "forums", id: node.id, seo },
    forumFeed:
      node.type === "forum"
        ? {
            title: node.title,
            path: `${canonicalPathOf(seo.canonical)}/feed.atom`,
          }
        : undefined,
  });
}

export default async function ForumPage({
  params,
  searchParams,
}: PageProps<"/[locale]/forums/[id]">) {
  const [{ id: raw }, { prefix, cursor, pages }] = await Promise.all([
    params,
    searchParams,
  ]);
  const { node, breadcrumbs, watching, resolvedPermissions } = await getNode(
    nodeIdOf(raw),
  );
  const seo = await seoOf(raw, searchParams);
  const [{ user }, widgets, t] = await Promise.all([
    getViewer(),
    getWidgets("forum"),
    getTranslations("forums.forum"),
  ]);
  const context = {
    params: { prefix },
    widgets,
    href: (query: [string, string][]) => {
      const kept = typeof prefix === "string" ? [["prefix", prefix]] : [];
      const extra = new URLSearchParams([...kept, ...query]).toString();
      return `/forums/${node.id}${extra && `?${extra}`}`;
    },
  };

  const isForum = node.type === "forum";
  const banner = await bannerOf(node.cover);
  const newThread = isForum && node.permissions.canPost && (
    <Link
      href={`/forums/${node.id}/new`}
      data-shortcut="create"
      className={cn(buttonVariants(), "h-10 px-3 md:h-8")}
    >
      <Plus />
      {t("newThread")}
    </Link>
  );
  const trail =
    breadcrumbs.at(-1)?.id === node.id ? breadcrumbs : [...breadcrumbs, node];

  return (
    <PageLayout
      className="pt-2"
      {...widgetAside(widgetAreas("forum", widgets).aside, context)}
    >
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
      <div
        className={cn(
          "mt-1 flex flex-wrap items-end justify-between gap-3",
          banner &&
            "relative isolate min-h-36 content-end overflow-hidden rounded-lg border p-4 md:min-h-44",
        )}
      >
        {banner}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {node.title}
          </h1>
          {node.description && (
            <p
              className={cn(
                "mt-1 max-w-2xl text-sm text-pretty",
                banner ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {node.description}
            </p>
          )}
        </div>
        {newThread}
      </div>
      {user && (
        <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2">
          {isForum && <ForumWatch nodeId={node.id} watching={watching} />}
          <ForumMarkRead nodeId={node.id} />
        </div>
      )}

      {isForum && (
        <Suspense fallback={null}>
          <Subforums nodeId={node.id} />
        </Suspense>
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
            pages={pagesParam(pages)}
            newThread={newThread}
            signedIn={user !== null}
            resolved={resolvedPermissions}
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
  const [{ items: nodes }, unread, t] = await Promise.all([
    read(nodesList, {}),
    unreadForums(),
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
    <ForumCardGrid
      forums={forums}
      childrenOf={childrenOf}
      member={member}
      unread={unread}
      className="mt-4"
    />
  );
}

// The forums inside a forum, above its threads (nothing when it has none).
async function Subforums({ nodeId }: { nodeId: number }) {
  const [{ items: nodes }, unread] = await Promise.all([
    read(nodesList, {}),
    unreadForums(),
  ]);
  const childrenOf = childrenByParent(nodes);
  const forums = childrenOf(nodeId);
  if (forums.length === 0) return null;
  const member = await membersFor(cardMembers(forums, childrenOf));
  return (
    <ForumCardGrid
      forums={forums}
      childrenOf={childrenOf}
      member={member}
      unread={unread}
      className="mt-4"
    />
  );
}

async function ForumThreads({
  nodeId,
  prefix,
  cursor,
  pages,
  newThread,
  signedIn,
  resolved,
}: {
  nodeId: number;
  prefix: string | undefined;
  cursor: string | undefined;
  pages: number;
  newThread: React.ReactNode;
  signedIn: boolean;
  // The viewer's permissions in the forum, for the staff tools on its list.
  resolved: Record<string, boolean | number>;
}) {
  const prefixId = /^[1-9]\d*$/.test(prefix ?? "") ? Number(prefix) : undefined;
  const [first, { items: allPrefixes }, { items: carried }, t] =
    await Promise.all([
      threadsPage(nodeId, prefixId, cursor),
      read(threadPrefixesList, { nodeId }),
      read(threadPrefixesList, { nodeId, carried: true }),
      getTranslations("forums.forum"),
    ]);
  // The batch tools set the prefixes the forum offers; the filter also lists a prefix the forum
  // stopped offering while threads still carry it.
  const prefixes = activePrefixViews(allPrefixes);
  const filterPrefixes = activePrefixViews(carried);
  const listed = first.rows.length > 0;
  // Staff who may change threads tick them in the list and apply one change to all.
  const batchActions = listed ? batchActionsFor(resolved) : [];
  const batchForums = batchActions.includes("move")
    ? (await forumsOtherThan(nodeId)).map(({ id, title }) => ({
        id,
        label: title,
      }))
    : [];

  return (
    <>
      {filterPrefixes.length > 0 && (
        <PrefixFilter id={nodeId} prefixes={filterPrefixes} active={prefixId} />
      )}

      {listed ? (
        <ThreadBatch
          action={batchUpdateThreadsAction.bind(null, nodeId)}
          actions={batchActions}
          forums={batchForums}
          prefixes={prefixes.map(({ id, label }) => ({ id, label }))}
        >
          <PagedList
            first={first}
            more={moreThreads.bind(null, nodeId, prefixId)}
            pages={pages}
            start={cursor}
            listKey={["forum", nodeId, prefixId ?? 0]}
            hrefBase={`/forums/${nodeId}${prefixId === undefined ? "" : `?prefix=${prefixId}`}`}
            moreLabel={t("loadMore")}
            estimateSize={72}
            as="ul"
            className={cn(
              "overflow-hidden rounded-lg border bg-card",
              filterPrefixes.length > 0 ? "mt-1" : "mt-4",
            )}
            moreClassName="mt-3"
          />
        </ThreadBatch>
      ) : (
        <div
          className={cn(
            "overflow-hidden rounded-lg border bg-card",
            filterPrefixes.length > 0 ? "mt-1" : "mt-4",
          )}
        >
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
        </div>
      )}
    </>
  );
}
