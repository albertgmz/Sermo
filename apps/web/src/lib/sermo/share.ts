import "server-only";

import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/locales";
import { publicUrl } from "./config";
import { type ShareKind, shareMetadata } from "./seo";
import { getSite } from "./site";

export type PublicPage = {
  // The page's own title, without the site's name; the head's when it is a plain one.
  title?: string;
  // The page's address, for a head that names no canonical one.
  path?: string;
  kind?: ShareKind;
  // A forum's own feed (its path), announced after the site's.
  forumFeed?: { title: string; path: string };
};

// The head of a page anyone may open, with what a share preview and a feed reader look for: the
// Open Graph and Twitter card tags (under the canonical address, the page's description or else
// the site's) and the site's Atom feed. A page that only some may open (a member's own, the
// staff's, one closed to guests) does not come here, so it carries none of them.
export async function publicHead(
  head: Metadata,
  page: PublicPage,
): Promise<Metadata> {
  const [site, locale, t] = await Promise.all([
    getSite(),
    getLocale(),
    getTranslations("lib.share"),
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
    }),
    alternates: {
      ...head.alternates,
      types: { "application/atom+xml": feeds },
    },
  };
}
