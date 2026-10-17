import "server-only";

import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/locales";
import { getLiteState } from "@/lib/lite-mode";
import {
  brandOf,
  CARD_SIZE,
  CARD_TYPE,
  type CardContent,
  type CardKind,
  cardOf,
  cardPath,
  siteContent,
} from "@/lib/og/card";
import { publicUrl } from "./config";
import {
  type Seo,
  type ShareImage,
  type ShareKind,
  shareMetadata,
} from "./seo";
import { getSite, type SiteIdentity } from "./site";

export type PublicPage = {
  // The page's own title, without the site's name; the head's when it is a plain one.
  title?: string;
  // The page's address, for a head that names no canonical one.
  path?: string;
  kind?: ShareKind;
  // A forum's own feed (its path), announced after the site's.
  forumFeed?: { title: string; path: string };
  // The page's own share card: a thread, forum or member, with the SEO read it is drawn from.
  // Without one (or when the read does not carry what it shows) the page shares the site's.
  card?: {
    kind: CardKind;
    id: number;
    seo: Pick<Seo, "description" | "jsonLd">;
  };
};

type ShareText = Awaited<ReturnType<typeof getTranslations<"lib.share">>>;

function altOf(content: CardContent, site: string, t: ShareText) {
  switch (content.kind) {
    case "threads":
      return t("card.thread", {
        title: content.title,
        forum: content.forum,
        site,
      });
    case "forums":
      return t("card.forum", { forum: content.title, site });
    case "members":
      return t("card.member", { member: content.title, site });
    case "site":
      return t("card.site", { site });
  }
}

// The picture of the page's share card, on the page's origin like its other addresses.
function cardImage(
  card: PublicPage["card"],
  site: SiteIdentity,
  origin: string,
  t: ShareText,
): ShareImage {
  const content = (card && cardOf(card.kind, card.seo)) ?? siteContent(site);
  return {
    url: new URL(cardPath(content, card?.id ?? null, brandOf(site)), origin)
      .href,
    ...CARD_SIZE,
    type: CARD_TYPE,
    alt: altOf(content, site.name, t),
  };
}

// The head of a page anyone may open, with what a share preview and a feed reader look for: the
// Open Graph and Twitter card tags (under the canonical address, the page's description or else
// the site's), the share card's picture (left out, like every picture address, when the visitor's
// LITE mode blocks any), the canonical address when the head names none, and the site's Atom
// feed. A page that only some may open (a member's own, the staff's, one closed to guests) does
// not come here, so it carries none of them.
export async function publicHead(
  head: Metadata,
  page: PublicPage,
): Promise<Metadata> {
  const [site, locale, t, lite] = await Promise.all([
    getSite(),
    getLocale(),
    getTranslations("lib.share"),
    getLiteState(),
  ]);
  // Every address of the page shares one origin: the canonical's (the backend's site address on
  // its pages), else this app's public address.
  const canonical = head.alternates?.canonical;
  const url =
    typeof canonical === "string"
      ? canonical
      : new URL(page.path ?? "/", publicUrl()).href;
  const { origin } = new URL(url);
  const feeds = [
    {
      title: t("siteFeed", { site: site.name }),
      url: new URL("/feed.atom", origin).href,
    },
  ];
  if (page.forumFeed) {
    feeds.push({
      title: t("forumFeed", { forum: page.forumFeed.title }),
      url: new URL(page.forumFeed.path, origin).href,
    });
  }
  return {
    ...head,
    ...shareMetadata({
      title:
        page.title ?? (typeof head.title === "string" ? head.title : site.name),
      description:
        (typeof head.description === "string" && head.description) ||
        site.description,
      url,
      siteName: site.name,
      locale: locale as Locale,
      kind: page.kind ?? { type: "website" },
      image:
        lite.master || lite.blocked.length > 0
          ? undefined
          : cardImage(page.card, site, origin, t),
    }),
    alternates: {
      ...head.alternates,
      canonical: head.alternates?.canonical ?? url,
      types: { "application/atom+xml": feeds },
    },
  };
}
