// The tabs of a profile are pages of their own under the profile's address (`/members/5-ann/posts`);
// the wall is the profile's own page. They used to be one page that named the tab in its query
// (`/members/5-ann?tab=posts`): those addresses go to the tab's page for good (`proxy.ts`).

import type { TabLink } from "@/components/forum/tab-links";

export const PROFILE_TABS = ["posts", "threads", "about"] as const;

export type ProfileTab = (typeof PROFILE_TABS)[number];

export const isProfileTab = (
  segment: string | undefined,
): segment is ProfileTab =>
  (PROFILE_TABS as readonly string[]).includes(segment ?? "");

// The path of a profile as the address spelled its segment (`54`, or `54-ann` with the slug). The
// links inside a profile keep that spelling: another one is another value of the layout's `[id]`,
// and a tab pressed would draw the layout (the header) again. A page load comes to the slugged
// address (the proxy sends it there); a member link (`/members/54`) followed in the browser does
// not, and the profile keeps that address.
export const profileAddress = (segment: string) =>
  `/members/${encodeURIComponent(segment)}`;

// The address of a tab of the profile at `profilePath` (the profile's own path).
export const profileTabPath = (profilePath: string, tab: ProfileTab) =>
  `${profilePath}/${tab}`;

// Where an old address of the profile at `profilePath` with the query `search` lives now: the page
// of the tab it names, with the rest of the query; the wall for a tab that is none of them.
// Undefined when the query names no tab.
export function profileTabTarget(
  profilePath: string,
  search: string,
): string | undefined {
  const params = new URLSearchParams(search);
  if (!params.has("tab")) return undefined;
  const tab = params.get("tab") ?? undefined;
  params.delete("tab");
  const path = isProfileTab(tab)
    ? profileTabPath(profilePath, tab)
    : profilePath;
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

// The tab bar of the profile at `address`: the wall (the profile's own page) and the tabs.
export function profileTabLinks(
  address: string,
  labels: Record<"wall" | ProfileTab, string>,
  postCount: number,
): TabLink[] {
  return [
    { value: "", label: labels.wall, href: address },
    ...PROFILE_TABS.map((tab) => ({
      value: tab,
      label: labels[tab],
      href: profileTabPath(address, tab),
      ...(tab === "posts" && { count: postCount }),
    })),
  ];
}
