import { forumTabsList, nodesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type * as z from "zod";
import { statsEntries } from "@/app/[locale]/(main)/forums/forum-stats";
import { CollapsiblePanel } from "@/components/forum/collapsible-panel";
import { bannerOf } from "@/components/forum/forum-banner";
import { ForumCardGrid } from "@/components/forum/forum-card-grid";
import type { Query } from "@/components/forum/places";
import { PendingTabLinks } from "@/components/forum/segment-tab-links";
import {
  ForumCategoriesSkeleton,
  LoadingRegion,
  TabsSkeleton,
} from "@/components/forum/skeletons";
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

// The section an address chooses.
export function forumListChoice(params: Query) {
  const { section } = params;
  return { section: typeof section === "string" ? section : null };
}

// The forum list: the categories under the section tabs, drawn by the home page. A section tab is
// a link to the page with its section in the address: a tab pressed is a navigation, the bar stays
// as it is and the categories of the section come in behind their placeholder (drawn again for
// each section: its key). The statistics panel is a widget the page draws around it.
//
// Props
//   params   The page's address parameters: the section tab (the id of a forum tab; none is the
//            first) and the statistics tabs, which a section link keeps.
export async function ForumList({ params }: { params: Query }) {
  const t = await getTranslations("forums.forums");
  const { section } = forumListChoice(params);
  // Asked once for both parts, which wait for it on their own.
  const tabs = read(forumTabsList, {});
  // A render that stops before the parts run leaves nobody to see a refusal; the parts that do
  // run still get it from their `await`.
  tabs.catch(() => {});
  return (
    <div className="space-y-(--page-gap)">
      <Suspense fallback={<TabsSkeleton />}>
        <SectionTabs tabs={tabs} params={params} section={section} />
      </Suspense>
      <Suspense
        key={section ?? ""}
        fallback={
          <LoadingRegion label={t("aria.loadingCategories")}>
            <ForumCategoriesSkeleton />
          </LoadingRegion>
        }
      >
        <ForumCategories tabs={tabs} section={section} />
      </Suspense>
    </div>
  );
}

type ForumTabs = Promise<z.output<typeof forumTabsList.output>>;

// The section tabs: a bar of links, the open one the section the address names.
async function SectionTabs({
  tabs: asked,
  params,
  section,
}: {
  tabs: ForumTabs;
  params: Query;
  section: string | null;
}) {
  const [{ items: tabs }, t] = await Promise.all([
    asked,
    getTranslations("forums.forums"),
  ]);
  const kept = statsEntries(params);
  const active = tabs.find((entry) => String(entry.id) === section) ?? tabs[0];
  if (!active) return null;
  return (
    <PendingTabLinks
      tabs={tabs.map((entry, index) => ({
        value: String(entry.id),
        label: entry.title,
        href: withQuery("/", index === 0 ? null : String(entry.id), kept),
      }))}
      active={String(active.id)}
      label={t("aria.sections")}
      variant="segmented"
    />
  );
}

// The categories of the open section.
async function ForumCategories({
  tabs: asked,
  section: param,
}: {
  tabs: ForumTabs;
  section: string | null;
}) {
  const [{ items: nodes }, { items: tabs }, { user }, unread, site] =
    await Promise.all([
      read(nodesList, {}),
      asked,
      getViewer(),
      unreadForums(),
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
    <div className="space-y-(--page-gap)">
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
  );
}
