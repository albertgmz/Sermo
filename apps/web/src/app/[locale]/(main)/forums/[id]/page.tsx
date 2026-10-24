import { nodesGet, nodesList } from "@sermo/core/contracts";
import { MessagesSquare } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import { ForumMarkRead } from "@/app/[locale]/(main)/forums/[id]/forum-mark-read";
import {
  ForumThreads,
  NewThreadButton,
} from "@/app/[locale]/(main)/forums/[id]/forum-threads";
import { ForumWatch } from "@/app/[locale]/(main)/forums/[id]/forum-watch";
import { forumThreadsSection } from "@/app/[locale]/(main)/forums/[id]/threads-section-action";
import { EmptyState } from "@/components/forum/empty-state";
import { bannerOf } from "@/components/forum/forum-banner";
import { ForumCardGrid } from "@/components/forum/forum-card-grid";
import { JsonLd } from "@/components/forum/json-ld";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { pageParam } from "@/components/forum/page-window";
import { placeOfQuery } from "@/components/forum/places";
import {
  LoadingRegion,
  TabsSkeleton,
  ThreadRowSkeleton,
} from "@/components/forum/skeletons";
import { TabSwitch } from "@/components/forum/tab-switch";
import { PageLayout } from "@/components/layout/page-layout";
import { widgetAreas, widgetAside } from "@/components/widgets/widget-area";
import { canonicalPathOf } from "@/lib/sermo/addresses";
import { read } from "@/lib/sermo/client";
import { cardMembers, childrenByParent, nodeMembers } from "@/lib/sermo/forums";
import { guestPostKey } from "@/lib/sermo/guest-posting";
import { parsePageId } from "@/lib/sermo/ids";
import { membersFor } from "@/lib/sermo/members";
import { copyOf, seoMetadata } from "@/lib/sermo/seo";
import { getViewer } from "@/lib/sermo/session";
import { publicHead } from "@/lib/sermo/share";
import { unreadForums } from "@/lib/sermo/unread-forums";
import { getWidgets } from "@/lib/sermo/widgets";
import { cn } from "@/lib/utils";

// The node is asked once for the metadata and the page.
const getNode = cache((nodeId: number) => read(nodesGet, { nodeId }));

function nodeIdOf(raw: string) {
  const id = parsePageId(raw);
  if (id === null) notFound();
  return id;
}

// The backend has one address for a forum; a later page of its list, or the list narrowed by
// prefix, is a copy of it.
async function seoOf(
  id: string,
  searchParams: PageProps<"/[locale]/forums/[id]">["searchParams"],
) {
  const [{ seo }, { prefix, page }] = await Promise.all([
    getNode(nodeIdOf(id)),
    searchParams,
  ]);
  return prefix !== undefined || pageParam(page) > 1 ? copyOf(seo) : seo;
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
  const [{ id: raw }, { prefix, page }] = await Promise.all([
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
  const guestKey = isForum
    ? await guestPostKey(user !== null, resolvedPermissions, node.settings)
    : null;
  const newThread = isForum && (node.permissions.canPost || guestKey) && (
    <NewThreadButton nodeId={node.id} />
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
        {(user || newThread) && (
          // As XenForo's: mark read and follow beside the button that starts a thread.
          <div className="flex flex-wrap items-end gap-2">
            {user && <ForumMarkRead nodeId={node.id} />}
            {user && isForum && (
              <ForumWatch nodeId={node.id} watching={watching} />
            )}
            {newThread}
          </div>
        )}
      </div>

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
          <TabSwitch
            place={placeOfQuery({ prefix }, ["prefix"])}
            params={["prefix"]}
            stamp={Date.now()}
            load={forumThreadsSection.bind(null, node.id)}
          >
            <ForumThreads
              nodeId={node.id}
              prefix={
                typeof prefix === "string" && /^[1-9]\d*$/.test(prefix)
                  ? prefix
                  : undefined
              }
              page={pageParam(page)}
              newThread={newThread}
              signedIn={user !== null}
              resolved={resolvedPermissions}
            />
          </TabSwitch>
        ) : (
          <CategoryForums nodeId={node.id} />
        )}
      </Suspense>
    </PageLayout>
  );
}

// A category holds no threads: its forums are what the page lists.
async function CategoryForums({ nodeId }: { nodeId: number }) {
  const [{ items: nodes }, unread, t, { user }] = await Promise.all([
    read(nodesList, {}),
    unreadForums(),
    getTranslations("forums.forum"),
    getViewer(),
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
      signedIn={user !== null}
      className="mt-4"
    />
  );
}

// The forums inside a forum, above its threads (nothing when it has none).
async function Subforums({ nodeId }: { nodeId: number }) {
  const [{ items: nodes }, unread, { user }] = await Promise.all([
    read(nodesList, {}),
    unreadForums(),
    getViewer(),
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
      signedIn={user !== null}
      className="mt-4"
    />
  );
}
