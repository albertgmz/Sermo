import { TABS } from "@/app/[locale]/(staff)/admin/users/[id]/tabs";
import { hrefFor, type Standing } from "@/app/[locale]/(staff)/registry";

export type ManageTab = { key: (typeof TABS)[number]; href: string };

// The admin tabs of a member that the viewer may open, for the "Manage" menu of the profile. The
// menu is for those who may manage members: the first tab (`usersEdit`) is gated by that right, so
// without it there is nothing to show. The checks are the registry's, as for the tab strip.
export function memberAdminTabs(
  viewer: Standing,
  memberId: number,
): ManageTab[] {
  if (!hrefFor(viewer, "usersEdit")) return [];
  return TABS.flatMap((key) => {
    const href = hrefFor(viewer, key);
    return href ? [{ key, href: href.replace("[id]", String(memberId)) }] : [];
  });
}
