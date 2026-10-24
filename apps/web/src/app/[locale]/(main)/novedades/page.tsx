import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import {
  FEED_SWITCH_PARAMS,
  FeedColumn,
  openingOf,
} from "@/app/[locale]/(main)/novedades/feed-column";
import { feedColumn } from "@/app/[locale]/(main)/novedades/feed-column-page";
import { placeOfQuery } from "@/components/forum/places";
import { TabSwitch } from "@/components/forum/tab-switch";
import { homeAddress, homeMetadata } from "@/lib/home-seo";
import { publicUrl } from "@/lib/sermo/config";
import { getGuestTab } from "@/lib/sermo/home-tab";
import { publicHead } from "@/lib/sermo/share";
import { getSite } from "@/lib/sermo/site";
import { getWidgets } from "@/lib/sermo/widgets";

// The head of the tab the page opens on. The bare address and the guests' own tab are one page.
export async function generateMetadata(
  props: PageProps<"/[locale]/novedades">,
): Promise<Metadata> {
  const [{ params, tab }, guestTab, site, t] = await Promise.all([
    opening(props.searchParams),
    getGuestTab(),
    getSite(),
    getTranslations("home.seo"),
  ]);
  const head = homeMetadata({
    address: homeAddress({ opened: tab, guestTab, params }),
    origin: publicUrl(),
    title: t(`${tab}.title`),
    description: t(`${tab}.description`, { site: site.name }),
  });
  // Following is the viewer's own list: nothing to share.
  if (tab === "following") return head;
  return publicHead(head, { title: t(`${tab}.title`) });
}

// The feed: the wall composer and the feed tabs, with the widgets of the page's positions (the
// featured threads above the tabs and the side blocks, by default). The home page (`/`) is the
// forum list. All of it under the site's header is what the tabs and the filters change in place
// (`TabSwitch`).
export default async function NovedadesPage(
  props: PageProps<"/[locale]/novedades">,
) {
  const [opened, widgets] = await Promise.all([
    opening(props.searchParams),
    getWidgets("novedades"),
  ]);
  return (
    <TabSwitch
      place={placeOfQuery(opened.params, FEED_SWITCH_PARAMS)}
      params={FEED_SWITCH_PARAMS}
      stamp={Date.now()}
      load={feedColumn}
    >
      <FeedColumn opened={opened} widgets={widgets} />
    </TabSwitch>
  );
}

// Once per request, for the head and the page.
const opening = cache(
  async (searchParams: PageProps<"/[locale]/novedades">["searchParams"]) =>
    openingOf(await searchParams),
);
