// The tabs of a profile are pages of their own under the profile's address (`/members/5-ann/posts`);
// the wall is the profile's own page. They used to be one page that named the tab in its query
// (`/members/5-ann?tab=posts`): those addresses go to the tab's page for good (`proxy.ts`).

export const PROFILE_TABS = ["posts", "threads", "about"] as const;

export type ProfileTab = (typeof PROFILE_TABS)[number];

export const isProfileTab = (
  segment: string | undefined,
): segment is ProfileTab =>
  (PROFILE_TABS as readonly string[]).includes(segment ?? "");

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
