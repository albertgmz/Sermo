// What the site stores in a visitor's browser, in one place: the cookie policy page and the
// banner are drawn from it, and `tests/consent-inventory.test.ts` scans the source for every
// name the code writes and fails when one is missing here. The words (purpose, lifetime) are in
// `messages/<locale>/cookies.json` under `items.<id>`.
import { LOCALE_COOKIE } from "@/i18n/locale-cookie";
import { LITE_COOKIE } from "@/lib/lite-preferences";
import { NOTICES_DISMISSED_COOKIE } from "@/lib/notice-dismissals";

export const CATEGORIES = [
  "necessary",
  "analytics",
  "referrals",
  "embeds",
] as const;
export type Category = (typeof CATEGORIES)[number];

// The categories a visitor can switch; `necessary` is always on.
export const OPTIONAL_CATEGORIES = [
  "analytics",
  "referrals",
  "embeds",
] as const;
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];

// The policy version the consent is recorded against. A change in what is stored or why raises it
// and every visitor is asked again. The backend's own number, when `site.get` carries one, wins
// (see `policyVersion` in `./state`).
export const POLICY_VERSION = 1;

// The cookie that holds the choice: the categories accepted, the policy version and the date.
export const CONSENT_COOKIE = "forum_consent";

// The cookie item 2 (referrals) sets once its category is accepted.
export const REFERRAL_COOKIE = "forum_ref";

// Where a value lives. A name ending in `*` is a prefix (the part after it varies).
export type Storage = "cookie" | "localStorage" | "sessionStorage";

export type InventoryItem = {
  // Key of `items.<id>` in the cookies messages.
  id: string;
  category: Category;
  storage: Storage;
  names: readonly string[];
  // Set by the site itself, or by a service of another party (then listed by `party`).
  party: "first" | string;
};

export const INVENTORY: readonly InventoryItem[] = [
  {
    id: "session",
    category: "necessary",
    storage: "cookie",
    names: [
      "sermo.session_token",
      "__Secure-sermo.session_token",
      "sermo.session_data",
      "__Secure-sermo.session_data",
      "sermo.dont_remember",
      "__Secure-sermo.dont_remember",
    ],
    party: "first",
  },
  {
    id: "consent",
    category: "necessary",
    storage: "cookie",
    names: [CONSENT_COOKIE],
    party: "first",
  },
  {
    id: "language",
    category: "necessary",
    storage: "cookie",
    names: [LOCALE_COOKIE],
    party: "first",
  },
  {
    id: "dataSaver",
    category: "necessary",
    storage: "cookie",
    names: [LITE_COOKIE],
    party: "first",
  },
  {
    id: "dataSaverReloads",
    category: "necessary",
    storage: "sessionStorage",
    names: [`${LITE_COOKIE}:reloads`],
    party: "first",
  },
  {
    id: "notices",
    category: "necessary",
    storage: "cookie",
    names: [NOTICES_DISMISSED_COOKIE],
    party: "first",
  },
  {
    id: "theme",
    category: "necessary",
    storage: "localStorage",
    names: ["sermo-theme"],
    party: "first",
  },
  {
    id: "width",
    category: "necessary",
    storage: "localStorage",
    names: ["sermo-width"],
    party: "first",
  },
  {
    id: "panels",
    category: "necessary",
    storage: "localStorage",
    names: ["forum-stats-open", "forum-category-*", "styleguide-*"],
    party: "first",
  },
  {
    id: "matomo",
    category: "analytics",
    storage: "cookie",
    names: ["_pk_id.*", "_pk_ses.*", "_pk_ref.*"],
    party: "Matomo",
  },
  {
    id: "google",
    category: "analytics",
    storage: "cookie",
    names: ["_ga", "_ga_*", "_gid", "_gat*"],
    party: "Google Analytics",
  },
  {
    id: "referral",
    category: "referrals",
    storage: "cookie",
    names: [REFERRAL_COOKIE],
    party: "first",
  },
  {
    id: "embeds",
    category: "embeds",
    storage: "cookie",
    names: [],
    party:
      "YouTube, Vimeo, Dailymotion, Giphy, TikTok, Spotify, SoundCloud, Apple Music",
  },
];

// The inventory of one category, for the policy page and the banner.
export const itemsOf = (category: Category) =>
  INVENTORY.filter((item) => item.category === category);

// Whether a cookie name belongs to a category's inventory (used to delete a withdrawn category's
// cookies): an exact name, or a prefix entry.
export function ownedBy(
  category: Category,
  name: string,
  storage: Storage = "cookie",
) {
  return INVENTORY.some(
    (item) =>
      item.category === category &&
      item.storage === storage &&
      item.names.some((entry) =>
        entry.endsWith("*")
          ? name.startsWith(entry.slice(0, -1))
          : entry === name,
      ),
  );
}
