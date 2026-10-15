import { nodesGet, nodesList, threadPrefixesList } from "@sermo/core/contracts";
import { MessagesSquare, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import { ForumWatch } from "@/app/[locale]/(main)/forums/[id]/forum-watch";
import { moreThreads } from "@/app/[locale]/(main)/forums/[id]/more-threads";
import { threadsPage } from "@/app/[locale]/(main)/forums/[id]/thread-page";
import { EmptyState } from "@/components/forum/empty-state";
import { ForumCard } from "@/components/forum/forum-card";
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
import { buttonVariants } from "@/components/ui/button";
import { pagesParam } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { childrenByParent, forumCard, nodeMembers } from "@/lib/sermo/forums";
import { parsePageId } from "@/lib/sermo/ids";
import { membersFor } from "@/lib/sermo/members";
import { copyOf, seoMetadata } from "@/lib/sermo/seo";
import { getViewer } from "@/lib/sermo/session";
import { prefixView } from "@/lib/sermo/threads";
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
  return seoMetadata(await seoOf((await params).id, searchParams));
}

export default async function ForumPage({
  params,
  searchParams,
}: PageProps<"/[locale]/forums/[id]">) {
  const [{ id: raw }, { prefix, cursor, pages }] = await Promise.all([
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
            pages={pagesParam(pages)}
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
  pages,
  newThread,
  signedIn,
}: {
  nodeId: number;
  prefix: string | undefined;
  cursor: string | undefined;
  pages: number;
  newThread: React.ReactNode;
  signedIn: boolean;
}) {
  const prefixId = /^[1-9]d*$/.test(prefix ?? "") ? Number(prefix) : undefined;
  const [first, { items: allPrefixes }, t] = await Promise.all([
    threadsPage(nodeId, prefixId, cursor),
    read(threadPrefixesList, {}),
    getTranslations("forums.forum"),
  ]);
  const prefixes = allPrefixes
    .filter((entry) => entry.isActive)
    .flatMap((entry) => prefixView(entry) ?? []);
  const listed = first.rows.length > 0;

  return (
    <>
      {prefixes.length > 0 && (
        <PrefixFilter id={nodeId} prefixes={prefixes} active={prefixId} />
      )}

      {listed ? (
        <PagedList
          first={first}
          more={moreThreads.bind(null, nodeId, prefixId)}
          pages={pages}
          start={cursor}
          listKey={["forum", nodeId, prefixId ?? 0]}
          hrefBase={`/forums/${nodeId}${prefixId === undefined ? "" : `?prefix=${prefixId}`}`}
          moreLabel={t("nextPage")}
          estimateSize={72}
          as="ul"
          className={cn(
            "overflow-hidden rounded-lg border bg-card",
            prefixes.length > 0 ? "mt-1" : "mt-4",
          )}
          moreClassName="mt-3"
        />
      ) : (
        <div
          className={cn(
            "overflow-hidden rounded-lg border bg-card",
            prefixes.length > 0 ? "mt-1" : "mt-4",
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
