// The one list of the panel's sections and screens. The navigation, the home grid and the
// proxy's gate all read it, so a screen exists in the panel if and only if it is here.
//
// A screen is added or changed here and nowhere else:
//   key    Message key of its label, under `admin.nav.screens` (and its id in this file).
//   path   Its address. `[id]` stands for a record id (plain decimal), any other `[name]` for one
//          word of letters, digits, `-` and `_`. Moderation lives under /moderation, everything
//          else under /admin.
//   access Who may open it: a list of permission ids of which ANY grants access (read from
//          `auth.me` `resolvedPermissions`, which holds the global permissions), or a predicate
//          over `auth.me` for the moderation screens, which a moderator of a single forum must
//          reach through `staff.moderatedNodeIds`. Only an ordering of the navigation: the
//          backend refuses what it does not allow.
//   built  Whether the route exists. An unbuilt screen is neither listed nor reachable (the gate
//          answers 404), so a section's worker flips this to true when the page is added.
//   listed false for a detail screen (a record, a tab of a record, a form behind a list): it is
//          gated like the others but has no entry in the navigation or the home grid. A detail
//          path must extend the path of a listed screen of the same section, which is how the
//          navigation marks the section it belongs to.
//   group  Only in "Groups and permissions": the labelled sub-group of the navigation.
//   landing true for the section's own page (link cards to its screens): the section's heading
//          in the navigation and the breadcrumbs link to it, so it is not listed among the
//          section's screens. Sections of /admin have theirs at `/admin/sections/<id>`, a path no
//          screen uses; moderation's is /moderation. Its label is the section's.
//
// A path that matches no screen here is a 404 for everyone. The first match wins and a static
// path beats a dynamic one (`/admin/forums/prefixes` against `/admin/forums/[id]`).
//
// This file is read by the proxy: keep it free of React, server-only modules and icons.

// What the registry needs from `auth.me`.
export type Standing = {
  resolvedPermissions: Record<string, boolean | number>;
  staff: {
    panel: boolean;
    moderatesEverywhere: boolean;
    moderatedNodeIds: number[];
  };
};

export type Access = readonly string[] | ((me: Standing) => boolean);

export type Screen = {
  key: string;
  path: string;
  access: Access;
  built: boolean;
  listed?: false;
  group?: "groups" | "permissions" | "staff";
  landing?: true;
};

export type Section = {
  id: string;
  screens: readonly Screen[];
};

const holds = (me: Standing, id: string) => me.resolvedPermissions[id] === true;

// Whether the member moderates anywhere. Node permissions are not in `resolvedPermissions`, so a
// moderator of a single forum is only visible here. The summary says "holds some moderation
// permission", not which one: the moderation screens open for any of them and the backend
// narrows what each queue lists.
const moderates = (me: Standing) =>
  me.staff.moderatesEverywhere || me.staff.moderatedNodeIds.length > 0;

const canHandleReports = (me: Standing) =>
  moderates(me) ||
  holds(me, "report.manageProfiles") ||
  holds(me, "conversation.moderate");

const canApprove = (me: Standing) =>
  moderates(me) ||
  holds(me, "profilePost.approve") ||
  holds(me, "conversation.moderate");

// `forum.viewLog` is a node permission, so a moderator of some forums stands in for it.
const canReadModeratorLog = (me: Standing) =>
  holds(me, "moderatorLog.view") || moderates(me);

// The sign-up queue is a global permission, so the moderation overview opens for it alone.
const canReviewSignups = (me: Standing) =>
  holds(me, "member.approveRegistrations");

const canModerate = (me: Standing) =>
  canHandleReports(me) ||
  canApprove(me) ||
  canReadModeratorLog(me) ||
  canReviewSignups(me);

// A section's landing shows the section's screens and nothing else, so it opens for anyone who may
// open one of them.
const opensSection =
  (id: string) =>
  (me: Standing): boolean =>
    SCREENS.some(
      (screen) =>
        screen.section === id &&
        !screen.landing &&
        screen.listed !== false &&
        screen.built &&
        canOpen(me, screen),
    );

// The panel's home opens for anyone the backend says has a panel, and for anyone who may open at
// least one other listed screen: a permission outside the moderation and administration categories
// (`award.grant`) opens a screen without making `staff.panel` true, and the member would
// otherwise have to type that screen's address. Nothing else is let in: the same screens are what
// `visibleSections` lists.
const opensAScreen = (me: Standing): boolean =>
  SCREENS.some(
    (screen) =>
      screen.section !== "home" &&
      screen.listed !== false &&
      screen.built &&
      canOpen(me, screen),
  );

export const SECTIONS = [
  {
    id: "home",
    screens: [
      {
        key: "home",
        path: "/admin",
        access: (me) => me.staff.panel || opensAScreen(me),
        built: true,
      },
    ],
  },
  {
    id: "setup",
    screens: [
      {
        key: "setupLanding",
        path: "/admin/sections/setup",
        access: opensSection("setup"),
        built: true,
        landing: true,
      },
      {
        key: "setupGeneral",
        path: "/admin/settings",
        access: ["admin.settings"],
        built: true,
      },
      {
        key: "setupHome",
        path: "/admin/settings/home",
        access: ["admin.settings"],
        built: true,
      },
      {
        key: "setupMembers",
        path: "/admin/settings/members",
        access: ["admin.settings"],
        built: true,
      },
      {
        key: "setupAntispam",
        path: "/admin/settings/antispam",
        access: ["admin.settings"],
        built: true,
      },
      {
        key: "setupUploads",
        path: "/admin/settings/uploads",
        access: ["admin.settings"],
        built: true,
      },
      {
        key: "setupSeo",
        path: "/admin/settings/seo",
        access: ["admin.settings"],
        built: true,
      },
      {
        key: "setupIdentity",
        path: "/admin/settings/identity",
        access: ["admin.settings"],
        built: true,
      },
      {
        key: "setupLevels",
        path: "/admin/settings/levels",
        access: ["admin.settings"],
        built: true,
      },
      {
        key: "setupCookies",
        path: "/admin/settings/cookies",
        access: ["admin.settings"],
        built: true,
      },
      {
        key: "setupNavigation",
        path: "/admin/settings/navigation",
        access: ["admin.navigation"],
        built: true,
      },
    ],
  },
  {
    id: "content",
    screens: [
      {
        key: "contentLanding",
        path: "/admin/sections/content",
        access: opensSection("content"),
        built: true,
        landing: true,
      },
      {
        key: "contentReactions",
        path: "/admin/reactions",
        access: ["admin.reactionTypes"],
        built: true,
      },
      {
        key: "contentReactionNew",
        path: "/admin/reactions/new",
        access: ["admin.reactionTypes"],
        built: true,
        listed: false,
      },
      {
        key: "contentReactionSort",
        path: "/admin/reactions/sort",
        access: ["admin.reactionTypes"],
        built: true,
        listed: false,
      },
      {
        key: "contentReactionEdit",
        path: "/admin/reactions/[id]",
        access: ["admin.reactionTypes"],
        built: true,
        listed: false,
      },
      {
        key: "contentWordFilters",
        path: "/admin/word-filters",
        access: ["wordFilter.view", "wordFilter.manage"],
        built: true,
      },
      {
        key: "contentWordFilterNew",
        path: "/admin/word-filters/new",
        access: ["wordFilter.view", "wordFilter.manage"],
        built: true,
        listed: false,
      },
      {
        key: "contentWordFilterEdit",
        path: "/admin/word-filters/[id]",
        access: ["wordFilter.view", "wordFilter.manage"],
        built: true,
        listed: false,
      },
      {
        key: "contentTags",
        path: "/admin/tags",
        access: ["tag.manage"],
        built: true,
      },
      {
        key: "contentTagEdit",
        path: "/admin/tags/[id]",
        access: ["tag.manage"],
        built: true,
        listed: false,
      },
      {
        key: "contentPages",
        path: "/admin/pages",
        access: ["admin.pages"],
        built: true,
      },
      {
        key: "contentPageNew",
        path: "/admin/pages/new",
        access: ["admin.pages"],
        built: true,
        listed: false,
      },
      {
        key: "contentPageEdit",
        path: "/admin/pages/[slug]",
        access: ["admin.pages"],
        built: true,
        listed: false,
      },
    ],
  },
  {
    id: "forums",
    screens: [
      {
        key: "forumsLanding",
        path: "/admin/sections/forums",
        access: opensSection("forums"),
        built: true,
        landing: true,
      },
      {
        key: "forumsTree",
        path: "/admin/forums",
        access: ["admin.nodes"],
        built: true,
      },
      {
        key: "forumsPrefixes",
        path: "/admin/forums/prefixes",
        access: ["admin.prefixes"],
        built: true,
      },
      {
        key: "forumsEdit",
        path: "/admin/forums/[id]",
        access: ["admin.nodes"],
        built: true,
        listed: false,
      },
      {
        key: "forumsPermissions",
        path: "/admin/forums/[id]/permissions",
        access: ["admin.permissions"],
        built: true,
        listed: false,
      },
      {
        key: "forumsNew",
        path: "/admin/forums/new/[type]",
        access: ["admin.nodes"],
        built: true,
        listed: false,
      },
      {
        key: "forumsSort",
        path: "/admin/forums/sort",
        access: ["admin.nodes"],
        built: true,
        listed: false,
      },
      {
        key: "forumsTabNew",
        path: "/admin/forums/tabs/new",
        access: ["admin.nodes"],
        built: true,
        listed: false,
      },
      {
        key: "forumsTabEdit",
        path: "/admin/forums/tabs/[id]",
        access: ["admin.nodes"],
        built: true,
        listed: false,
      },
      {
        key: "forumsPrefixNew",
        path: "/admin/forums/prefixes/new",
        access: ["admin.prefixes"],
        built: true,
        listed: false,
      },
      {
        key: "forumsPrefixEdit",
        path: "/admin/forums/prefixes/[id]",
        access: ["admin.prefixes"],
        built: true,
        listed: false,
      },
    ],
  },
  {
    id: "communication",
    screens: [
      {
        key: "communicationLanding",
        path: "/admin/sections/communication",
        access: opensSection("communication"),
        built: true,
        landing: true,
      },
      {
        key: "communicationAnnouncements",
        path: "/admin/announcements",
        access: ["admin.announcements"],
        built: true,
      },
      {
        key: "communicationAnnouncementNew",
        path: "/admin/announcements/new",
        access: ["admin.announcements"],
        built: true,
        listed: false,
      },
      {
        key: "communicationNotices",
        path: "/admin/notices",
        access: ["admin.announcements"],
        built: true,
      },
      {
        key: "communicationNoticeNew",
        path: "/admin/notices/new",
        access: ["admin.announcements"],
        built: true,
        listed: false,
      },
      {
        key: "communicationNoticeEdit",
        path: "/admin/notices/[id]",
        access: ["admin.announcements"],
        built: true,
        listed: false,
      },
      {
        key: "communicationNotifications",
        path: "/admin/notifications",
        access: ["admin.settings"],
        built: true,
      },
      {
        key: "communicationEmail",
        path: "/admin/email",
        access: ["admin.settings"],
        built: true,
      },
    ],
  },
  {
    id: "users",
    screens: [
      {
        key: "usersLanding",
        path: "/admin/sections/users",
        access: opensSection("users"),
        built: true,
        landing: true,
      },
      {
        key: "usersList",
        path: "/admin/users",
        access: ["admin.members"],
        built: true,
      },
      {
        key: "usersBatch",
        path: "/admin/users/batch",
        access: ["admin.members"],
        built: true,
        listed: false,
      },
      {
        key: "usersBans",
        path: "/admin/bans",
        access: ["member.ban"],
        built: true,
      },
      {
        key: "setupWarnings",
        path: "/admin/settings/warnings",
        access: ["admin.settings"],
        built: true,
      },
      {
        key: "usersEdit",
        path: "/admin/users/[id]",
        access: ["admin.members"],
        built: true,
        listed: false,
      },
      {
        key: "usersGroups",
        path: "/admin/users/[id]/groups",
        access: ["admin.members"],
        built: true,
        listed: false,
      },
      {
        key: "usersProfile",
        path: "/admin/users/[id]/profile",
        access: ["admin.members"],
        built: true,
        listed: false,
      },
      {
        key: "usersAppearance",
        path: "/admin/users/[id]/appearance",
        access: ["admin.members"],
        built: true,
        listed: false,
      },
      {
        key: "usersPermissions",
        path: "/admin/users/[id]/permissions",
        access: ["admin.permissions"],
        built: true,
        listed: false,
      },
      {
        key: "usersSanctions",
        path: "/admin/users/[id]/sanctions",
        access: ["admin.members"],
        built: true,
        listed: false,
      },
      {
        key: "usersEconomy",
        path: "/admin/users/[id]/economy",
        access: ["credits.viewAny", "credits.adjust", "admin.shop"],
        built: true,
        listed: false,
      },
      {
        key: "usersSessions",
        path: "/admin/users/[id]/sessions",
        access: ["admin.members"],
        built: true,
        listed: false,
      },
      {
        key: "usersHistory",
        path: "/admin/users/[id]/history",
        access: ["admin.members"],
        built: true,
        listed: false,
      },
    ],
  },
  {
    id: "groups",
    screens: [
      {
        key: "groupsLanding",
        path: "/admin/sections/groups",
        access: opensSection("groups"),
        built: true,
        landing: true,
      },
      {
        key: "groupsList",
        path: "/admin/groups",
        access: ["admin.groups"],
        built: true,
        group: "groups",
      },
      {
        key: "groupsNew",
        path: "/admin/groups/new",
        access: ["admin.groups"],
        built: true,
        listed: false,
      },
      {
        key: "groupsEdit",
        path: "/admin/groups/[id]",
        access: ["admin.groups"],
        built: true,
        listed: false,
      },
      {
        key: "groupsPromotions",
        path: "/admin/promotions",
        access: ["admin.promotions"],
        built: true,
        group: "groups",
      },
      {
        key: "groupsPromotionNew",
        path: "/admin/promotions/new",
        access: ["admin.promotions"],
        built: true,
        listed: false,
      },
      {
        key: "groupsPromotionEdit",
        path: "/admin/promotions/[id]",
        access: ["admin.promotions"],
        built: true,
        listed: false,
      },
      {
        key: "permissionsGroups",
        path: "/admin/permissions/groups",
        access: ["admin.permissions"],
        built: true,
        group: "permissions",
      },
      {
        key: "permissionsGroupEdit",
        path: "/admin/permissions/groups/[id]",
        access: ["admin.permissions"],
        built: true,
        listed: false,
      },
      {
        key: "permissionsMembers",
        path: "/admin/permissions/members",
        access: ["admin.permissions"],
        built: true,
        group: "permissions",
      },
      {
        key: "permissionsMemberEdit",
        path: "/admin/permissions/members/[id]",
        access: ["admin.permissions"],
        built: true,
        listed: false,
      },
      {
        key: "permissionsForums",
        path: "/admin/permissions/forums",
        access: ["admin.permissions"],
        built: true,
        group: "permissions",
      },
      {
        key: "permissionsExplain",
        path: "/admin/permissions/explain",
        access: ["admin.permissions"],
        built: true,
        group: "permissions",
      },
      {
        key: "staffModerators",
        path: "/admin/staff/moderators",
        access: ["admin.permissions"],
        built: true,
        group: "staff",
      },
      {
        key: "staffAdministrators",
        path: "/admin/staff/administrators",
        access: ["admin.permissions"],
        built: true,
        group: "staff",
      },
    ],
  },
  {
    id: "appearance",
    screens: [
      {
        key: "appearanceLanding",
        path: "/admin/sections/appearance",
        access: opensSection("appearance"),
        built: true,
        landing: true,
      },
      {
        key: "appearanceFrames",
        path: "/admin/appearance/frames",
        access: ["admin.appearance"],
        built: true,
      },
      {
        key: "appearanceFramesNew",
        path: "/admin/appearance/frames/new",
        access: ["admin.appearance"],
        built: true,
        listed: false,
      },
      {
        key: "appearanceFramesEdit",
        path: "/admin/appearance/frames/[id]",
        access: ["admin.appearance"],
        built: true,
        listed: false,
      },
      {
        key: "appearanceCovers",
        path: "/admin/appearance/covers",
        access: ["admin.appearance"],
        built: true,
      },
      {
        key: "appearanceCoversNew",
        path: "/admin/appearance/covers/new",
        access: ["admin.appearance"],
        built: true,
        listed: false,
      },
      {
        key: "appearanceCoversEdit",
        path: "/admin/appearance/covers/[id]",
        access: ["admin.appearance"],
        built: true,
        listed: false,
      },
      {
        key: "appearanceThreadCovers",
        path: "/admin/appearance/thread-covers",
        access: ["admin.appearance"],
        built: true,
      },
      {
        key: "appearanceThreadCoversNew",
        path: "/admin/appearance/thread-covers/new",
        access: ["admin.appearance"],
        built: true,
        listed: false,
      },
      {
        key: "appearanceThreadCoversEdit",
        path: "/admin/appearance/thread-covers/[id]",
        access: ["admin.appearance"],
        built: true,
        listed: false,
      },
      {
        key: "appearanceAccents",
        path: "/admin/appearance/accents",
        access: ["admin.appearance"],
        built: true,
      },
      {
        key: "appearanceAccentsNew",
        path: "/admin/appearance/accents/new",
        access: ["admin.appearance"],
        built: true,
        listed: false,
      },
      {
        key: "appearanceAccentsEdit",
        path: "/admin/appearance/accents/[id]",
        access: ["admin.appearance"],
        built: true,
        listed: false,
      },
      {
        key: "appearanceNameColors",
        path: "/admin/appearance/name-colors",
        access: ["admin.appearance"],
        built: true,
      },
      {
        key: "appearanceNameColorsNew",
        path: "/admin/appearance/name-colors/new",
        access: ["admin.appearance"],
        built: true,
        listed: false,
      },
      {
        key: "appearanceNameColorsEdit",
        path: "/admin/appearance/name-colors/[id]",
        access: ["admin.appearance"],
        built: true,
        listed: false,
      },
      {
        key: "appearancePrefixColors",
        path: "/admin/appearance/prefix-colors",
        access: ["admin.appearance"],
        built: true,
      },
      {
        key: "appearancePrefixColorsNew",
        path: "/admin/appearance/prefix-colors/new",
        access: ["admin.appearance"],
        built: true,
        listed: false,
      },
      {
        key: "appearancePrefixColorsEdit",
        path: "/admin/appearance/prefix-colors/[id]",
        access: ["admin.appearance"],
        built: true,
        listed: false,
      },
    ],
  },
  {
    id: "economy",
    screens: [
      {
        key: "economyLanding",
        path: "/admin/sections/economy",
        access: opensSection("economy"),
        built: true,
        landing: true,
      },
      {
        key: "economyCreditRules",
        path: "/admin/credit-rules",
        access: ["admin.creditRules"],
        built: true,
      },
      {
        key: "economyCreditRuleNew",
        path: "/admin/credit-rules/new",
        access: ["admin.creditRules"],
        built: true,
        listed: false,
      },
      {
        key: "economyCreditRuleEdit",
        path: "/admin/credit-rules/[id]",
        access: ["admin.creditRules"],
        built: true,
        listed: false,
      },
      {
        key: "economyCredits",
        path: "/admin/credits",
        access: ["credits.adjust"],
        built: true,
      },
      {
        key: "economyAwards",
        path: "/admin/awards",
        access: ["admin.awards"],
        built: true,
      },
      {
        key: "economyAwardNew",
        path: "/admin/awards/new",
        access: ["admin.awards"],
        built: true,
        listed: false,
      },
      {
        key: "economyAwardEdit",
        path: "/admin/awards/[id]",
        access: ["admin.awards"],
        built: true,
        listed: false,
      },
      {
        key: "economyAwardGrants",
        path: "/admin/award-grants",
        access: ["award.grant"],
        built: true,
      },
      {
        key: "economyShopCategories",
        path: "/admin/shop/categories",
        access: ["admin.shop"],
        built: true,
      },
      {
        key: "economyShopCategoryNew",
        path: "/admin/shop/categories/new",
        access: ["admin.shop"],
        built: true,
        listed: false,
      },
      {
        key: "economyShopCategorySort",
        path: "/admin/shop/categories/sort",
        access: ["admin.shop"],
        built: true,
        listed: false,
      },
      {
        key: "economyShopCategoryEdit",
        path: "/admin/shop/categories/[id]",
        access: ["admin.shop"],
        built: true,
        listed: false,
      },
      {
        key: "economyShopItems",
        path: "/admin/shop/items",
        access: ["admin.shop"],
        built: true,
      },
      {
        key: "economyShopItemNew",
        path: "/admin/shop/items/new",
        access: ["admin.shop"],
        built: true,
        listed: false,
      },
      {
        key: "economyShopItemEdit",
        path: "/admin/shop/items/[id]",
        access: ["admin.shop"],
        built: true,
        listed: false,
      },
    ],
  },
  {
    id: "tools",
    screens: [
      {
        key: "toolsLanding",
        path: "/admin/sections/tools",
        access: opensSection("tools"),
        built: true,
        landing: true,
      },
      {
        key: "toolsMaintenance",
        path: "/admin/tools",
        access: [
          "credits.adjust",
          "admin.promotions",
          "admin.awards",
          "member.spamCleanup",
        ],
        built: true,
      },
    ],
  },
  {
    id: "logs",
    screens: [
      {
        key: "logsLanding",
        path: "/admin/sections/logs",
        access: opensSection("logs"),
        built: true,
        landing: true,
      },
      {
        key: "toolsModeratorLog",
        path: "/admin/logs/moderator",
        access: canReadModeratorLog,
        built: true,
      },
      {
        key: "toolsPromotionLog",
        path: "/admin/logs/promotions",
        access: ["admin.promotions"],
        built: true,
      },
      {
        key: "toolsCreditLedger",
        path: "/admin/logs/credits",
        access: ["credits.viewAny"],
        built: true,
      },
      {
        key: "toolsShopPurchases",
        path: "/admin/logs/purchases",
        access: ["admin.shop"],
        built: true,
      },
      {
        key: "toolsTasks",
        path: "/admin/logs/tasks",
        access: ["admin.settings"],
        built: true,
      },
    ],
  },
  {
    id: "moderation",
    screens: [
      {
        key: "moderationHome",
        path: "/moderation",
        access: canModerate,
        built: true,
        landing: true,
      },
      {
        key: "moderationReports",
        path: "/moderation/reports",
        access: canHandleReports,
        built: true,
      },
      {
        key: "moderationReportCase",
        path: "/moderation/reports/[id]",
        access: canHandleReports,
        built: true,
        listed: false,
      },
      {
        key: "moderationReportMessage",
        path: "/moderation/reports/[id]/message",
        access: ["conversation.moderate"],
        built: true,
        listed: false,
      },
      {
        key: "moderationApprovals",
        path: "/moderation/approvals",
        access: canApprove,
        built: true,
      },
      {
        key: "moderationApprovalReview",
        path: "/moderation/approvals/[type]/[id]",
        access: canApprove,
        built: true,
        listed: false,
      },
      {
        key: "moderationSignups",
        path: "/moderation/signups",
        access: ["member.approveRegistrations"],
        built: true,
      },
      {
        key: "moderationIps",
        path: "/moderation/ips",
        access: ["member.viewIps"],
        built: true,
      },
    ],
  },
] as const satisfies readonly Section[];

export type SectionId = (typeof SECTIONS)[number]["id"];
export type ScreenKey = (typeof SECTIONS)[number]["screens"][number]["key"];

// The screens that are not a landing: those with a label of their own (a landing takes its
// section's).
export type PageKey = Exclude<
  ScreenKey,
  Extract<
    (typeof SECTIONS)[number]["screens"][number],
    { landing: true }
  >["key"]
>;

export type ListedScreen = Screen & { key: ScreenKey; section: SectionId };

export const SCREENS: readonly ListedScreen[] = SECTIONS.flatMap((section) =>
  section.screens.map((screen) => ({ ...screen, section: section.id })),
);

export function canOpen(me: Standing, screen: Pick<Screen, "access">) {
  const { access } = screen;
  return typeof access === "function"
    ? access(me)
    : access.some((id) => holds(me, id));
}

// `[id]` is a record id in plain decimal, any other parameter one plain word.
function patternOf(path: string) {
  const source = path
    .split("/")
    .map((part) => {
      const parameter = /^\[(\w+)\]$/.exec(part);
      if (!parameter) return part.replace(/[.*+?^${}()|\\]/g, "\\$&");
      return parameter[1] === "id" ? "[1-9]\\d{0,14}" : "[A-Za-z0-9_-]+";
    })
    .join("/");
  return new RegExp(`^${source}$`);
}

// The screens ready for matching; tests compile a list of their own.
type Compiled = { screen: Screen; pattern: RegExp; dynamic: boolean }[];

export function compile(screens: readonly Screen[]): Compiled {
  return screens.map((screen) => ({
    screen,
    pattern: patternOf(screen.path),
    dynamic: screen.path.includes("["),
  }));
}

const PATTERNS = compile(SCREENS);

// The screen an address belongs to, built or not, or undefined when the panel has no such
// address. A trailing slash does not matter.
export function screenAt(pathname: string, compiled: Compiled = PATTERNS) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const matches = compiled.filter(({ pattern }) => pattern.test(path));
  return (matches.find(({ dynamic }) => !dynamic) ?? matches[0])?.screen;
}

export const isStaffPath = (pathname: string) =>
  /^\/(admin|moderation)(\/|$)/.test(pathname);

// The gate: whether the member may open the address. A screen that is not built is a 404.
export function mayOpenPath(
  me: Standing,
  pathname: string,
  compiled: Compiled = PATTERNS,
) {
  const screen = screenAt(pathname, compiled);
  if (!screen?.built) return false;
  return canOpen(me, screen);
}

export type VisibleSection = {
  id: SectionId;
  landing?: ListedScreen;
  screens: readonly (ListedScreen & { key: PageKey })[];
};

// What the navigation and the home grid show the member: the section's landing and its listed,
// built screens, those they may open, and only the sections that keep at least one of them.
export function visibleSections(me: Standing): VisibleSection[] {
  return SECTIONS.map((section) => {
    const open = SCREENS.filter(
      (screen) =>
        screen.section === section.id &&
        screen.listed !== false &&
        screen.built &&
        canOpen(me, screen),
    );
    return {
      id: section.id,
      landing: open.find((screen) => screen.landing),
      screens: open.filter(
        (screen): screen is ListedScreen & { key: PageKey } => !screen.landing,
      ),
    };
  }).filter((section) => section.landing || section.screens.length > 0);
}

export type TrailStep = { screen: ListedScreen; href: string };

// The way up from an address of the panel, for its breadcrumb: the panel's home, the section's
// landing, then, for a detail screen, each screen of the same section the address lies under (a
// record's own screen included, at its own address), keeping only those the member may open. The
// address's own screen is not part of it.
export function trailOf(me: Standing, pathname: string): TrailStep[] {
  const found = screenAt(pathname);
  const own = found && SCREENS.find((screen) => screen.key === found.key);
  if (!own || own.key === "home") return [];
  const steps: TrailStep[] = [{ screen: screenByKey("home"), href: "/admin" }];
  const landing = SCREENS.find(
    (screen) => screen.section === own.section && screen.landing,
  );
  if (landing && landing !== own) {
    steps.push({ screen: landing, href: landing.path });
  }
  // A listed screen hangs from its landing alone: one whose address extends another's (the
  // settings pages under the general settings) is its sibling, not its child.
  const parts =
    own.listed === false ? pathname.replace(/\/+$/, "").split("/") : [];
  for (let end = 2; end < parts.length; end++) {
    const href = parts.slice(0, end).join("/");
    const above = screenAt(href);
    const screen =
      above && SCREENS.find((candidate) => candidate.key === above.key);
    if (
      screen &&
      screen.section === own.section &&
      !steps.some((step) => step.screen === screen)
    ) {
      steps.push({ screen, href });
    }
  }
  return steps.filter(({ screen }) => screen.built && canOpen(me, screen));
}

export const screenByKey = (key: ScreenKey) =>
  SCREENS.find((screen) => screen.key === key) as ListedScreen;

// Where a link to the screen may point for this member, or undefined: the screen is not built
// yet, or they may not open it.
export function hrefFor(me: Standing, key: ScreenKey) {
  const screen = screenByKey(key);
  return screen.built && canOpen(me, screen) ? screen.path : undefined;
}

// The styleguide at /ui shows internals of the app, so it is gated like the panel: only a member
// who can open some screen of the panel sees it, and everyone else gets the 404 of an address
// that does not exist.
export const isStyleguidePath = (pathname: string) =>
  /^\/ui(\/|$)/.test(pathname);

export const mayOpenStyleguide = (me: Pick<Standing, "staff">) =>
  me.staff.panel;
