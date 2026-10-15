import { forumTabsList, nodesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  ForumStats,
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
import { read } from "@/lib/sermo/client";
import { childrenByParent, forumCard, nodeMembers } from "@/lib/sermo/forums";
import { membersFor } from "@/lib/sermo/members";
import { getSite } from "@/lib/sermo/site";

// The forum list: the statistics panel (when the site shows it) and the categories under the
// section tabs. The `/forums` page and the home page's Forums tab both draw it; each says where
// its section and statistics links go.
//
// Props
//   section  The section tab chosen in the address (the id of a forum tab), or null for the first.
//   stats    The statistics tab chosen in the address.
//   hrefFor  The address of a section (null is the first) with a statistics tab.
export async function ForumList({
  section,
  stats,
  hrefFor,
}: {
  section: string | null;
  stats: StatsTab;
  hrefFor: (section: string | null, stats: StatsTab) => string;
}) {
  const [{ forumStatsEnabled }, t] = await Promise.all([
    getSite(),
    getTranslations("forums.forums"),
  ]);
  return (
    <>
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
            hrefFor={(value) => hrefFor(section, value)}
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
        <ForumCategories section={section} stats={stats} hrefFor={hrefFor} />
      </Suspense>
    </>
  );
}

async function ForumCategories({
  section: param,
  stats,
  hrefFor,
}: {
  section: string | null;
  stats: StatsTab;
  hrefFor: (section: string | null, stats: StatsTab) => string;
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
            href: hrefFor(index === 0 ? null : String(entry.id), stats),
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
