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

const canModerate = (me: Standing) =>
  canHandleReports(me) || canApprove(me) || canReadModeratorLog(me);

export const SECTIONS = [
  {
    id: "home",
    screens: [
      {
        key: "home",
        path: "/admin",
        access: (me) => me.staff.panel,
        built: true,
      },
    ],
  },
  {
    id: "setup",
    screens: [
      {
        key: "setupGeneral",
        path: "/admin/settings",
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
        key: "setupWarnings",
        path: "/admin/settings/warnings",
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
        built: false,
      },
      {
        key: "setupLevels",
        path: "/admin/settings/levels",
        access: ["admin.settings"],
        built: true,
      },
      {
        key: "setupNavigation",
        path: "/admin/settings/navigation",
        access: ["admin.settings"],
        built: true,
      },
    ],
  },
  {
    id: "forums",
    screens: [
      {
        key: "forumsTree",
        path: "/admin/forums",
        access: ["admin.nodes"],
        built: false,
      },
      {
        key: "forumsPrefixes",
        path: "/admin/forums/prefixes",
        access: ["admin.nodes"],
        built: false,
      },
      {
        key: "forumsEdit",
        path: "/admin/forums/[id]",
        access: ["admin.nodes"],
        built: false,
        listed: false,
      },
      {
        key: "forumsPermissions",
        path: "/admin/forums/[id]/permissions",
        access: ["admin.permissions"],
        built: false,
        listed: false,
      },
    ],
  },
  {
    id: "content",
    screens: [
      {
        key: "contentReactions",
        path: "/admin/reactions",
        access: ["admin.reactionTypes"],
        built: false,
      },
      {
        key: "contentWordFilters",
        path: "/admin/word-filters",
        access: ["wordFilter.view", "wordFilter.manage"],
        built: false,
      },
      {
        key: "contentPages",
        path: "/admin/pages",
        access: ["admin.settings"],
        built: false,
      },
      {
        key: "contentPageEdit",
        path: "/admin/pages/[slug]",
        access: ["admin.settings"],
        built: false,
        listed: false,
      },
    ],
  },
  {
    id: "communication",
    screens: [
      {
        key: "communicationAnnouncements",
        path: "/admin/announcements",
        access: ["admin.announcements"],
        built: false,
      },
      {
        key: "communicationAnnouncementNew",
        path: "/admin/announcements/new",
        access: ["admin.announcements"],
        built: false,
        listed: false,
      },
      {
        key: "communicationNotifications",
        path: "/admin/notifications",
        access: ["admin.settings"],
        built: false,
      },
      {
        key: "communicationEmail",
        path: "/admin/email",
        access: ["admin.settings"],
        built: false,
      },
    ],
  },
  {
    id: "users",
    screens: [
      {
        key: "usersList",
        path: "/admin/users",
        access: ["admin.members"],
        built: true,
      },
      {
        key: "usersBans",
        path: "/admin/bans",
        access: ["member.ban"],
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
        key: "groupsList",
        path: "/admin/groups",
        access: ["admin.groups"],
        built: true,
        group: "groups",
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
        key: "appearanceFrames",
        path: "/admin/appearance/frames",
        access: ["admin.appearance"],
        built: false,
      },
      {
        key: "appearanceCovers",
        path: "/admin/appearance/covers",
        access: ["admin.appearance"],
        built: false,
      },
      {
        key: "appearanceThreadCovers",
        path: "/admin/appearance/thread-covers",
        access: ["admin.appearance"],
        built: false,
      },
      {
        key: "appearanceAccents",
        path: "/admin/appearance/accents",
        access: ["admin.appearance"],
        built: false,
      },
      {
        key: "appearanceNameColors",
        path: "/admin/appearance/name-colors",
        access: ["admin.appearance"],
        built: false,
      },
      {
        key: "appearancePrefixColors",
        path: "/admin/appearance/prefix-colors",
        access: ["admin.appearance"],
        built: false,
      },
    ],
  },
  {
    id: "economy",
    screens: [
      {
        key: "economyCreditRules",
        path: "/admin/credit-rules",
        access: ["admin.creditRules"],
        built: false,
      },
      {
        key: "economyCredits",
        path: "/admin/credits",
        access: ["credits.adjust"],
        built: false,
      },
      {
        key: "economyAwards",
        path: "/admin/awards",
        access: ["admin.awards"],
        built: false,
      },
      {
        key: "economyAwardEdit",
        path: "/admin/awards/[id]",
        access: ["admin.awards"],
        built: false,
        listed: false,
      },
      {
        key: "economyAwardGrants",
        path: "/admin/award-grants",
        access: ["award.grant"],
        built: false,
      },
      {
        key: "economyShopCategories",
        path: "/admin/shop/categories",
        access: ["admin.shop"],
        built: false,
      },
      {
        key: "economyShopItems",
        path: "/admin/shop/items",
        access: ["admin.shop"],
        built: false,
      },
      {
        key: "economyShopItemEdit",
        path: "/admin/shop/items/[id]",
        access: ["admin.shop"],
        built: false,
        listed: false,
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
    ],
  },
  {
    id: "tools",
    screens: [
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
] as const satisfies readonly Section[];

export type SectionId = (typeof SECTIONS)[number]["id"];
export type ScreenKey = (typeof SECTIONS)[number]["screens"][number]["key"];

type ListedScreen = Screen & { key: ScreenKey; section: SectionId };

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
  screens: readonly ListedScreen[];
};

// What the navigation and the home grid show the member: the listed, built screens they may
// open, and only the sections that keep at least one.
export function visibleSections(me: Standing): VisibleSection[] {
  return SECTIONS.map((section) => ({
    id: section.id,
    screens: SCREENS.filter(
      (screen) =>
        screen.section === section.id &&
        screen.listed !== false &&
        screen.built &&
        canOpen(me, screen),
    ),
  })).filter((section) => section.screens.length > 0);
}

export const screenByKey = (key: ScreenKey) =>
  SCREENS.find((screen) => screen.key === key) as ListedScreen;

// Where a link to the screen may point for this member, or undefined: the screen is not built
// yet, or they may not open it.
export function hrefFor(me: Standing, key: ScreenKey) {
  const screen = screenByKey(key);
  return screen.built && canOpen(me, screen) ? screen.path : undefined;
}
