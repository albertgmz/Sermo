// The links of the account screens: one list that the account page (its section navigation and its
// "more" tiles) and the avatar menu both read. Plain data, so a server or a client module can import
// it. `label` is a key of `account.navigation`; null is the Data saver, labelled from `lite`.
export const ACCOUNT_GROUPS = [
  {
    title: "accountHeading",
    links: [
      { label: "profile", href: "/account" },
      { label: "bookmarks", href: "/account/bookmarks" },
    ],
  },
  {
    title: "settingsHeading",
    links: [
      { label: "privacy", href: "/account/privacy" },
      { label: "notifications", href: "/account/notifications" },
      { label: "preferences", href: "/account/preferences" },
      { label: "perks", href: "/account/permissions" },
      // Labelled from the LITE messages.
      { label: null, href: "/account/data-saver" },
      { label: "security", href: "/account/security" },
    ],
  },
] as const;

export type AccountLink = (typeof ACCOUNT_GROUPS)[number]["links"][number];

export const DATA_SAVER_HREF = "/account/data-saver";

// The bookmarks have a tab of their own in the avatar menu.
const NOT_IN_MENU: readonly string[] = ["/account/bookmarks"];

export function accountLinks(): AccountLink[] {
  return ACCOUNT_GROUPS.flatMap((group): AccountLink[] => [...group.links]);
}

// What the Account tab of the avatar menu lists after the entries of the site's own account
// navigation: the account screens, except the ones the menu reaches another way (`taken` are the
// addresses it already lists, so the settings link stays when an admin switches its entry off).
export function menuAccountLinks(taken: readonly string[]): AccountLink[] {
  return accountLinks().filter(
    ({ href }) => !NOT_IN_MENU.includes(href) && !taken.includes(href),
  );
}
