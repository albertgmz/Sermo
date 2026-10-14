import { forumTabsList, nodesList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  ForumStats,
  STATS_TABS,
  type StatsTab,
} from "@/app/[locale]/(main)/forums/forum-stats";
import { CollapsiblePanel } from "@/components/forum/collapsible-panel";
import { ForumCard } from "@/components/forum/forum-card";
import {
  ForumCategoriesSkeleton,
  ForumStatsSkeleton,
  LoadingRegion,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { TabLinks } from "@/components/forum/tab-links";
import { PageHero } from "@/components/layout/page-hero";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { childrenByParent, forumCard, nodeMembers } from "@/lib/sermo/forums";
import { membersFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import { getSite } from "@/lib/sermo/site";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("forums.forums");
  return { title: t("metaTitle") };
}

function forumsHref(tab: string | null, stats: StatsTab) {
  const params = new URLSearchParams();
  if (tab !== null) params.set("tab", tab);
  if (stats !== STATS_TABS[0].value) params.set("stats", stats);
  const query = params.toString();
  return query ? `/forums?${query}` : "/forums";
}

async function GuestHero() {
  const t = await getTranslations("forums.forums");
  return (
    <PageHero title={t("heading")} subtitle={t("description")}>
      <Link
        href="/login"
        className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
      >
        {t("login")}
      </Link>
      <Link href="/register" className={cn(buttonVariants(), "h-10 px-4")}>
        {t("register")}
      </Link>
    </PageHero>
  );
}

export default async function ForumsPage({
  searchParams,
}: PageProps<"/[locale]/forums">) {
  const { tab, stats: statsParam } = await searchParams;
  const stats: StatsTab =
    STATS_TABS.find((entry) => entry.value === statsParam)?.value ??
    STATS_TABS[0].value;
  const selected = typeof tab === "string" ? tab : null;
  const [{ user }, { forumStatsEnabled }] = await Promise.all([
    getViewer(),
    getSite(),
  ]);
  const t = await getTranslations("forums.forums");

  return (
    <>
      {!user && <GuestHero />}
      <PageLayout
        className={user ? undefined : "pt-2"}
        mainClassName="space-y-(--page-gap)"
      >
        {forumStatsEnabled && (
          <Suspense
            fallback={
              <LoadingRegion label={t("aria.loadingStatistics")}>
                <ForumStatsSkeleton />
              </LoadingRegion>
            }
          >
            <ForumStats
              active={stats}
              hrefFor={(value) => forumsHref(selected, value)}
            />
          </Suspense>
        )}

        <Suspense
          fallback={
            <LoadingRegion label={t("aria.loadingCategories")}>
              <TabsSkeleton />
              <ForumCategoriesSkeleton />
            </LoadingRegion>
          }
        >
          <ForumCategories tab={selected} stats={stats} />
        </Suspense>
      </PageLayout>
    </>
  );
}

async function ForumCategories({
  tab: param,
  stats,
}: {
  tab: string | null;
  stats: StatsTab;
}) {
  const [{ items: nodes }, { items: tabs }, t] = await Promise.all([
    read(nodesList, {}),
    read(forumTabsList, {}),
    getTranslations("forums.forums"),
  ]);
  const member = await membersFor(nodeMembers(nodes));
  const childrenOf = childrenByParent(nodes);
  const active = tabs.find((entry) => String(entry.id) === param) ?? tabs[0];
  // A category with no tab shows under every tab.
  const categories = nodes.filter(
    (node) =>
      node.depth === 0 &&
      (!active || node.tabId === null || node.tabId === active.id),
  );

  return (
    <>
      {active && (
        <TabLinks
          tabs={tabs.map((entry, index) => ({
            value: String(entry.id),
            label: entry.title,
            href: forumsHref(index === 0 ? null : String(entry.id), stats),
          }))}
          active={String(active.id)}
          label={t("aria.sections")}
          variant="segmented"
        />
      )}
      {categories.map((category) => (
        <CollapsiblePanel
          key={category.id}
          title={category.title}
          storageKey={`forum-category-${category.id}-open`}
        >
          <ul className="grid gap-2 p-2 md:grid-cols-2">
            {(category.type === "category"
              ? childrenOf(category.id)
              : [category]
            ).map((forum) => (
              <ForumCard
                key={forum.id}
                forum={forumCard(forum, childrenOf(forum.id), member)}
                className="md:last:odd:col-span-2"
              />
            ))}
          </ul>
        </CollapsiblePanel>
      ))}
    </>
  );
}
