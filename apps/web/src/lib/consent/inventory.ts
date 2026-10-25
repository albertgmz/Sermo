// What the site stores in a visitor's browser, in one place: the cookie policy page and the
// banner are drawn from it, and `tests/consent-inventory.test.ts` scans the source for every
// name the code writes and fails when one is missing here. The words (purpose, lifetime) are in
// `messages/<locale>/cookies.json` under `items.<id>`.

import { RECENT_KEY, TONE_KEY } from "@/components/forum/emoji-storage";
import { ACCOUNT_THEME_COOKIE } from "@/components/layout/theme";
import { LOCALE_COOKIE } from "@/i18n/locale-cookie";
import { PROMPTS_KEY, VISIT_KEY } from "@/lib/app-prompts";
import { FEED_VIEW_COOKIE } from "@/lib/feed-view";
import { LITE_COOKIE } from "@/lib/lite-preferences";
import { NOTICES_DISMISSED_COOKIE } from "@/lib/notice-dismissals";
import { PUSH_OWNER_KEY, PUSH_SESSION_KEY } from "@/lib/push-device";

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

// The first policy version, and the one assumed while the site cannot be read. The version in
// force is the site's (`cookiePolicyVersion`, raised by an administrator when what is stored or
// why changes, which asks every visitor again).
export const POLICY_VERSION = 1;

// The cookie that holds the choice: the categories accepted, the policy version and the date.
export const CONSENT_COOKIE = "forum_consent";

// The cookie item 2 (referrals) sets once its category is accepted.
export const REFERRAL_COOKIE = "forum_ref";

// Where a value lives. A name ending in `*` is a prefix (the part after it varies).
export type Storage =
  | "cookie"
  | "localStorage"
  | "sessionStorage"
  | "cacheStorage"
  | "indexedDB";

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
    id: "feedView",
    category: "necessary",
    storage: "cookie",
    names: [FEED_VIEW_COOKIE],
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
    id: "accountTheme",
    category: "necessary",
    storage: "cookie",
    names: [ACCOUNT_THEME_COOKIE],
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
    id: "emojiPicker",
    category: "necessary",
    storage: "localStorage",
    names: [RECENT_KEY, TONE_KEY],
    party: "first",
  },
  {
    id: "panels",
    category: "necessary",
    storage: "localStorage",
    names: [
      "forum-stats-open",
      "forum-stats-*",
      "forum-category-*",
      "styleguide-*",
    ],
    party: "first",
  },
  {
    // When the cards that offer the app and notifications were put off ("Not now").
    id: "appPrompts",
    category: "necessary",
    storage: "localStorage",
    names: [PROMPTS_KEY],
    party: "first",
  },
  {
    // The pages of this visit and the card shown in it, so one visit shows one card.
    id: "appVisit",
    category: "necessary",
    storage: "sessionStorage",
    names: [VISIT_KEY],
    party: "first",
  },
  {
    // What the editor of a post in a thread, or of a message in a conversation, held when "More
    // options" opened the edit page, read once by that page.
    id: "editDraft",
    category: "necessary",
    storage: "sessionStorage",
    names: ["sermo-edit-draft:*"],
    party: "first",
  },
  {
    // The address of a +18 page a visitor left to log in or sign up, read once when they leave its
    // warning window, so that they go home instead of back to the log-in page.
    id: "adultGateSignIn",
    category: "necessary",
    storage: "sessionStorage",
    names: ["sermo.adult-gate.sign-in"],
    party: "first",
  },
  {
    // The member who turned on notifications in this browser, so no one else who signs in here
    // receives theirs, and the session that device was last saved under (a number, no secret).
    id: "pushOwner",
    category: "necessary",
    storage: "localStorage",
    names: [PUSH_OWNER_KEY, PUSH_SESSION_KEY],
    party: "first",
  },
  {
    // The service worker (public/sw.js, registered in production) keeps the scripts, styles and
    // fonts of the site so that pages load faster, and the offline page. It is strictly necessary
    // in the sense the other items here are: it holds only the site's own public static files,
    // no account data, no page and no identifier, and the site works without it. Nothing is read
    // back to tell visitors apart. The registration itself is part of this item.
    id: "offlineFiles",
    category: "necessary",
    storage: "cacheStorage",
    names: ["sermo-static-*", "serwist-precache-*"],
    party: "first",
  },
  {
    id: "offlineFilesIndex",
    category: "necessary",
    storage: "indexedDB",
    names: ["serwist-expiration"],
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
    // Cloudflare's widget on the guest forms, loaded only where the site has it on. It is a
    // security measure, so it stays out of the consent categories.
    id: "turnstile",
    category: "necessary",
    storage: "cookie",
    names: [],
    party: "Cloudflare",
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
