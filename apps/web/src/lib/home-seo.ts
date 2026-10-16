import type { Metadata } from "next";
import { type HomeTab, homeHref, tabParam } from "@/lib/home-tabs";

type Params = Record<string, string | string[] | undefined>;

export type HomeAddress = {
  // The canonical address of what the page shows, as a path with its query.
  path: string;
  // Whether this very address may be indexed: only the plain address of a public tab.
  index: boolean;
};

// The canonical address of the tab the page shows, and whether the address asked for is the one to
// index. The bare address is the canonical of the tab guests open on (a guest never opens
// Following, so Latest stands in for it); every other tab has its named address. An address with
// anything beyond a valid `tab` (a cursor, `pages`, a feed filter, a picture, a section, a notice)
// or a `tab` the page did not open (Following asked by a guest) is a copy: it points at the tab
// and stays out of the index, as `copyOf` does for the pages the backend describes. Following is
// the viewer's own list, so it is never indexed.
export function homeAddress({
  opened,
  guestTab,
  params,
}: {
  opened: HomeTab;
  guestTab: HomeTab;
  params: Params;
}): HomeAddress {
  const landing = guestTab === "following" ? "latest" : guestTab;
  const path = opened === landing ? "/" : homeHref(opened);
  const named = tabParam(params.tab);
  const keys = Object.keys(params).filter((key) => params[key] !== undefined);
  const plain =
    keys.every((key) => key === "tab") &&
    (named === null
      ? !keys.includes("tab")
      : typeof params.tab === "string" && named === opened);
  return { path, index: plain && opened !== "following" };
}

// The head of the home page for one tab: its own title (the layout adds the site's name), a
// description, the canonical address, robots and the Open Graph card. The texts come from the
// caller, already in the page's language.
export function homeMetadata({
  address,
  origin,
  siteName,
  title,
  description,
}: {
  address: HomeAddress;
  origin: string;
  siteName: string;
  title: string;
  description: string;
}): Metadata {
  const url = new URL(address.path, origin).href;
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: address.index, follow: true },
    openGraph: {
      type: "website",
      title: `${title} - ${siteName}`,
      description,
      url,
      siteName,
    },
  };
}
