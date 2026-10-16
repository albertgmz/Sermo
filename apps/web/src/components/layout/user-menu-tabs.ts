// The tabs of the avatar menu and the rules that go with them. Plain data, so the menu's client
// parts and its tests share them. Alerts and conversations have their own header buttons.
export const MENU_TABS = ["account", "bookmarks"] as const;

export type MenuTab = (typeof MENU_TABS)[number];

// The tab the menu opens on, each time.
export const OPENING_TAB: MenuTab = "account";

// The avatar button, the same whether it is the plain one drawn first or the real one that
// replaces it when the menu opens.
export const MENU_TRIGGER_CLASS =
  "group relative flex h-10 items-center gap-1.5 rounded-md px-1.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:text-foreground";
