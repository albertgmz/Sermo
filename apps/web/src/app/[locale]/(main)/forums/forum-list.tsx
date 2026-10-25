import { forumTabsList, nodesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { forumSection } from "@/app/[locale]/(main)/forums/forum-list-page";
import {
  STATS_TABS,
  type StatsTab,
} from "@/app/[locale]/(main)/forums/forum-stats";
import { CollapsiblePanel } from "@/components/forum/collapsible-panel";
import { bannerOf } from "@/components/forum/forum-banner";
import { ForumCardGrid } from "@/components/forum/forum-card-grid";
import { placeOfQuery, type Query } from "@/components/forum/places";
import {
  ForumCategoriesSkeleton,
  LoadingRegion,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { TabLinks } from "@/components/forum/tab-links";
import { TabSwitch } from "@/components/forum/tab-switch";
import { read } from "@/lib/sermo/client";
import { childrenByParent, nodeMembers } from "@/lib/sermo/forums";
import { membersFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import { getSite } from "@/lib/sermo/site";
import { unreadForums } from "@/lib/sermo/unread-forums";

// The forum list's address of a section (null is the first) with `query` set on it.
export function withQuery(
  path: string,
  section: string | null,
  query: [string, string][],
) {
  const params = new URLSearchParams(
    section === null ? [] : [["section", section]],
  );
  for (const [key, value] of query) params.set(key, value);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

// The address of a section with a statistics tab.
export function forumsHref(section: string | null, stats: StatsTab) {
  return withQuery(
    "/",
    section,
    stats === STATS_TABS[0].value ? [] : [["stats", stats]],
  );
}

// The parameter of the address the section tabs change in place.
export const FORUM_SECTION_PARAMS = ["section"];

// The section and the statistics tab an address chooses.
export function forumListChoice(params: Query) {
  const { section, stats } = params;
  return {
    section: typeof section === "string" ? section : null,
    stats:
      STATS_TABS.find((entry) => entry.value === stats)?.value ??
      STATS_TABS[0].value,
  };
}

// The forum list: the categories under the section tabs, drawn by the home page. The section tabs
// change it in place (`TabSwitch`). The statistics panel is a widget the page draws around it.
//
// Props
//   params   The page's address parameters: the section tab (the id of a forum tab; none is the
//            first) and the statistics tab, which a section link keeps.
export async function ForumList({ params }: { params: Query }) {
  const t = await getTranslations("forums.forums");
  const { section, stats } = forumListChoice(params);
  return (
    <TabSwitch
      place={placeOfQuery(params, FORUM_SECTION_PARAMS)}
      params={FORUM_SECTION_PARAMS}
      stamp={Date.now()}
      load={forumSection}
      className="space-y-(--page-gap)"
    >
      <Suspense
        fallback={
          <LoadingRegion label={t("aria.loadingCategories")}>
            <TabsSkeleton />
            <ForumCategoriesSkeleton />
          </LoadingRegion>
        }
      >
        <ForumCategories section={section} stats={stats} />
      </Suspense>
    </TabSwitch>
  );
}

// The section tabs and the categories of the open section; also what a section tab pressed brings
// in place (`forumSection`).
export async function ForumCategories({
  section: param,
  stats,
}: {
  section: string | null;
  stats: StatsTab;
}) {
  const [{ items: nodes }, { items: tabs }, { user }, unread, t, site] =
    await Promise.all([
      read(nodesList, {}),
      read(forumTabsList, {}),
      getViewer(),
      unreadForums(),
      getTranslations("forums.forums"),
      getSite(),
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
            href: forumsHref(index === 0 ? null : String(entry.id), stats),
          }))}
          active={String(active.id)}
          label={t("aria.sections")}
          variant="segmented"
        />
      )}
      <div data-switch-panel="" className="space-y-(--page-gap)">
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
              unread={unread}
              signedIn={user !== null}
              adultMode={site.adultMode}
              className="p-2"
            />
          </CollapsiblePanel>
        ))}
      </div>
    </>
  );
}
