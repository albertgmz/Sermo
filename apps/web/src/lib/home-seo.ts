import type { Metadata } from "next";
import {
  type HomeTab,
  homeHref,
  tabParam,
  WHATS_NEW_PATH,
} from "@/lib/home-tabs";
import { REFERRAL_PARAM } from "@/lib/referral/link";

type Params = Record<string, string | string[] | undefined>;

// Parameters that change nothing the page shows: campaign tags, click ids and the referral code.
// They do not make an address a copy.
const IGNORED = /^(utm_.*|fbclid|gclid)$/i;
const ignored = (key: string) => key === REFERRAL_PARAM || IGNORED.test(key);

export type HomeAddress = {
  // The canonical address of what the page shows, as a path with its query.
  path: string;
  // Whether this very address may be indexed: only the plain address of a public tab.
  index: boolean;
};

// The keys of an address that count: tracking parameters and the referral code do not.
const keysOf = (params: Params) =>
  Object.keys(params).filter(
    (key) => params[key] !== undefined && !ignored(key),
  );

// The canonical address of the feed tab `/whats-new` shows, and whether the address asked for is
// the one to index. The bare address is the canonical of the tab guests open on (a guest never
// opens Following, so Latest stands in for it); every other tab has its named address. An address
// with anything beyond a valid `tab` (a cursor, `pages`, a feed filter, a picture) or a `tab` the
// page did not open (Following asked by a guest) is a copy: it points at the tab and stays out of
// the index, as `copyOf` does for the pages the backend describes. Following is the viewer's own
// list, so it is never indexed.
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
  const path = opened === landing ? WHATS_NEW_PATH : homeHref(opened);
  const named = tabParam(params.tab);
  const keys = keysOf(params);
  const plain =
    keys.every((key) => key === "tab") &&
    (named === null
      ? !keys.includes("tab")
      : typeof params.tab === "string" && named === opened);
  return { path, index: plain && opened !== "following" };
}

// The home page, the forum list: `/` is its one address; a section, a statistics tab or a notice
// makes a copy of it.
export function forumListAddress(params: Params): HomeAddress {
  return { path: "/", index: keysOf(params).length === 0 };
}

// The head of the home page or of a feed tab: its own title (the layout adds the site's name), a
// description, the canonical address and robots. The texts come from the caller, already in the
// page's language.
export function homeMetadata({
  address,
  origin,
  title,
  description,
}: {
  address: HomeAddress;
  origin: string;
  title: string;
  description: string;
}): Metadata {
  const url = new URL(address.path, origin).href;
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: address.index, follow: true },
  };
}
