import { forumTabsList, nodesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type { StatsTab } from "@/app/[locale]/(main)/forums/forum-stats";
import { ForumMarkRead } from "@/app/[locale]/(main)/forums/[id]/forum-mark-read";
import { CollapsiblePanel } from "@/components/forum/collapsible-panel";
import { bannerOf } from "@/components/forum/forum-banner";
import { ForumCardGrid } from "@/components/forum/forum-card-grid";
import {
  ForumCategoriesSkeleton,
  LoadingRegion,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { TabLinks } from "@/components/forum/tab-links";
import { read } from "@/lib/sermo/client";
import { childrenByParent, nodeMembers } from "@/lib/sermo/forums";
import { membersFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";

// The forum list: the categories under the section tabs, drawn by the home page; it says where its
// section links go. The statistics panel is a widget the page draws around it.
//
// Props
//   section  The section tab chosen in the address (the id of a forum tab), or null for the first.
//   stats    The statistics tab chosen in the address, which a section link keeps.
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
  const t = await getTranslations("forums.forums");
  return (
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
  const [{ items: nodes }, { items: tabs }, { user }, t] = await Promise.all([
    read(nodesList, {}),
    read(forumTabsList, {}),
    getViewer(),
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

  // Only a category has a header to put its cover behind. A top-level forum is drawn as a card,
  // which already holds its cover, so the picture is not repeated above it. The first header with
  // a picture is above the fold and loads at once.
  const bannered = (category: (typeof categories)[number]) =>
    category.type === "category" ? category.cover : null;
  const first = categories.findIndex(bannered);
  const banners = await Promise.all(
    categories.map((category, index) =>
      bannerOf(bannered(category), index !== first),
    ),
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
      {user && (
        <div className="flex justify-end">
          <ForumMarkRead />
        </div>
      )}
      {categories.map((category, index) => (
        <CollapsiblePanel
          key={category.id}
          title={category.title}
          storageKey={`forum-category-${category.id}-open`}
          banner={banners[index]}
        >
          <ForumCardGrid
            forums={
              category.type === "category"
                ? childrenOf(category.id)
                : [category]
            }
            childrenOf={childrenOf}
            member={member}
            className="p-2"
          />
        </CollapsiblePanel>
      ))}
    </>
  );
}
