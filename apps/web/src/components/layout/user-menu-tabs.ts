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

// The avatar button, the same whether it is the plain one drawn first or the real one that
// replaces it when the menu opens.
export const MENU_TRIGGER_CLASS =
  "group relative flex h-10 items-center gap-1.5 rounded-md px-1.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:text-foreground";
