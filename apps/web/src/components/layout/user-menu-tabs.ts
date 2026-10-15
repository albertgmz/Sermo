import { keepPreviousData } from "@tanstack/react-query";

// The tabs of the avatar menu and the rules that go with them. Plain data and functions, so the
// menu's client parts and its tests share them.
export const MENU_TABS = [
  "alerts",
  "conversations",
  "account",
  "bookmarks",
] as const;

export type MenuTab = (typeof MENU_TABS)[number];

export type MenuUnread = { notifications: number; conversations: number };

// The tab the menu opens on: the first one with something unread (alerts, then conversations),
// otherwise the Account tab.
export function openingTab(unread: MenuUnread): MenuTab {
  if (unread.notifications > 0) return "alerts";
  if (unread.conversations > 0) return "conversations";
  return "account";
}

// What the avatar button shows: both counts as one. Bookmarks have no unread notion.
export function combinedUnread(unread: MenuUnread): number {
  return unread.notifications + unread.conversations;
}

// The count drawn on a badge: short for a large number.
export function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

// The lists that are asked for when their tab opens, and the key each is held under. The count is
// part of the key: a new unread count asks for the list again, and the rows of the last count stay
// up until the new ones arrive.
export type ListKind = "alerts" | "conversations" | "bookmarks";

export const listKey = (kind: ListKind, count: number) =>
  ["user-menu", kind, count] as const;

// How a list is asked for: when its tab mounts (never before), always fresh, held only while a tab
// shows it (the rows belong to the member who opened it). Rendered rows are not plain data, so the
// answer is not compared with the last one.
export function listQuery(
  kind: ListKind,
  count: number,
  load: () => Promise<React.ReactNode>,
) {
  return {
    queryKey: listKey(kind, count),
    queryFn: load,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
    placeholderData: keepPreviousData,
  };
}
