import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { PERMISSIONS } from "../../../../../../packages/core/src/permissions/registry";
import {
  compile,
  mayOpenPath,
  SCREENS,
  type Screen,
  SECTIONS,
  type Standing,
  screenAt,
  trailOf,
  visibleSections,
} from "./registry";

const standing = (
  held: string[] = [],
  staff: Partial<Standing["staff"]> = {},
): Standing => ({
  resolvedPermissions: Object.fromEntries(held.map((id) => [id, true])),
  staff: {
    panel: held.length > 0 || Object.keys(staff).length > 0,
    moderatesEverywhere: false,
    moderatedNodeIds: [],
    ...staff,
  },
});

const member = standing();
const singleForumModerator = standing([], { moderatedNodeIds: [3] });
const announcer = standing(["admin.announcements"]);
const settingsAdmin = standing(["admin.settings"]);
// `award.grant` is outside the categories that make the backend report a panel.
const grantor = standing(["award.grant"], { panel: false });
const moderator = standing(["moderation.access"], {
  moderatesEverywhere: true,
});
const administrator = standing(
  Object.keys(PERMISSIONS).filter((id) => id.startsWith("admin.")),
  { moderatesEverywhere: true },
);

// An address the screen answers: a record id is 7, any other parameter one word.
const sampleOf = (path: string) =>
  path.replace(/\[(\w+)\]/g, (_, name: string) =>
    name === "id" ? "7" : "word",
  );

// Every screen built, so that the rules alone decide.
const everything = compile(
  SCREENS.map((screen) => ({ ...screen, built: true })),
);
const may = (me: Standing, path: string) => mayOpenPath(me, path, everything);

test("every permission id the registry names is a permission of the backend", () => {
  const known = new Set(Object.keys(PERMISSIONS));
  for (const screen of SCREENS) {
    if (typeof screen.access === "function") continue;
    for (const id of screen.access) expect(known.has(id)).toBe(true);
  }
});

test("keys and paths are unique, and a path belongs to its section's zone", () => {
  expect(new Set(SCREENS.map((s) => s.key)).size).toBe(SCREENS.length);
  expect(new Set(SCREENS.map((s) => s.path)).size).toBe(SCREENS.length);
  for (const screen of SCREENS) {
    const zone = screen.section === "moderation" ? "/moderation" : "/admin";
    expect(screen.path === zone || screen.path.startsWith(`${zone}/`)).toBe(
      true,
    );
  }
});

// Every screen of the panel as it was before the sections were regrouped: its address and its rule
// (the permission ids, or the name of the rule function). Regrouping moves screens between
// sections; it never changes where a screen is or who may open it.
const GATES_BEFORE: Record<string, [string, string | string[]]> = {
  home: ["/admin", "access"],
  setupGeneral: ["/admin/settings", ["admin.settings"]],
  setupHome: ["/admin/settings/home", ["admin.settings"]],
  setupMembers: ["/admin/settings/members", ["admin.settings"]],
  setupAntispam: ["/admin/settings/antispam", ["admin.settings"]],
  setupWarnings: ["/admin/settings/warnings", ["admin.settings"]],
  setupUploads: ["/admin/settings/uploads", ["admin.settings"]],
  setupSeo: ["/admin/settings/seo", ["admin.settings"]],
  setupIdentity: ["/admin/settings/identity", ["admin.settings"]],
  setupLevels: ["/admin/settings/levels", ["admin.settings"]],
  setupCookies: ["/admin/settings/cookies", ["admin.settings"]],
  setupNavigation: ["/admin/settings/navigation", ["admin.navigation"]],
  forumsTree: ["/admin/forums", ["admin.nodes"]],
  forumsPrefixes: ["/admin/forums/prefixes", ["admin.prefixes"]],
  forumsEdit: ["/admin/forums/[id]", ["admin.nodes"]],
  forumsPermissions: ["/admin/forums/[id]/permissions", ["admin.permissions"]],
  contentReactions: ["/admin/reactions", ["admin.reactionTypes"]],
  contentReactionNew: ["/admin/reactions/new", ["admin.reactionTypes"]],
  contentReactionSort: ["/admin/reactions/sort", ["admin.reactionTypes"]],
  contentReactionEdit: ["/admin/reactions/[id]", ["admin.reactionTypes"]],
  contentWordFilters: [
    "/admin/word-filters",
    ["wordFilter.view", "wordFilter.manage"],
  ],
  contentTags: ["/admin/tags", ["tag.manage"]],
  contentPages: ["/admin/pages", ["admin.pages"]],
  contentPageEdit: ["/admin/pages/[slug]", ["admin.pages"]],
  communicationAnnouncements: ["/admin/announcements", ["admin.announcements"]],
  communicationAnnouncementNew: [
    "/admin/announcements/new",
    ["admin.announcements"],
  ],
  communicationNotices: ["/admin/notices", ["admin.announcements"]],
  communicationNoticeEdit: ["/admin/notices/[id]", ["admin.announcements"]],
  communicationNotifications: ["/admin/notifications", ["admin.settings"]],
  communicationEmail: ["/admin/email", ["admin.settings"]],
  usersList: ["/admin/users", ["admin.members"]],
  usersBatch: ["/admin/users/batch", ["admin.members"]],
  usersBans: ["/admin/bans", ["member.ban"]],
  usersEdit: ["/admin/users/[id]", ["admin.members"]],
  usersGroups: ["/admin/users/[id]/groups", ["admin.members"]],
  usersProfile: ["/admin/users/[id]/profile", ["admin.members"]],
  usersAppearance: ["/admin/users/[id]/appearance", ["admin.members"]],
  usersPermissions: ["/admin/users/[id]/permissions", ["admin.permissions"]],
  usersSanctions: ["/admin/users/[id]/sanctions", ["admin.members"]],
  usersEconomy: [
    "/admin/users/[id]/economy",
    ["credits.viewAny", "credits.adjust", "admin.shop"],
  ],
  usersSessions: ["/admin/users/[id]/sessions", ["admin.members"]],
  usersHistory: ["/admin/users/[id]/history", ["admin.members"]],
  groupsList: ["/admin/groups", ["admin.groups"]],
  groupsEdit: ["/admin/groups/[id]", ["admin.groups"]],
  groupsPromotions: ["/admin/promotions", ["admin.promotions"]],
  groupsPromotionEdit: ["/admin/promotions/[id]", ["admin.promotions"]],
  permissionsGroups: ["/admin/permissions/groups", ["admin.permissions"]],
  permissionsGroupEdit: [
    "/admin/permissions/groups/[id]",
    ["admin.permissions"],
  ],
  permissionsMembers: ["/admin/permissions/members", ["admin.permissions"]],
  permissionsMemberEdit: [
    "/admin/permissions/members/[id]",
    ["admin.permissions"],
  ],
  permissionsForums: ["/admin/permissions/forums", ["admin.permissions"]],
  permissionsExplain: ["/admin/permissions/explain", ["admin.permissions"]],
  staffModerators: ["/admin/staff/moderators", ["admin.permissions"]],
  staffAdministrators: ["/admin/staff/administrators", ["admin.permissions"]],
  appearanceFrames: ["/admin/appearance/frames", ["admin.appearance"]],
  appearanceFramesNew: ["/admin/appearance/frames/new", ["admin.appearance"]],
  appearanceFramesEdit: ["/admin/appearance/frames/[id]", ["admin.appearance"]],
  appearanceCovers: ["/admin/appearance/covers", ["admin.appearance"]],
  appearanceCoversNew: ["/admin/appearance/covers/new", ["admin.appearance"]],
  appearanceCoversEdit: ["/admin/appearance/covers/[id]", ["admin.appearance"]],
  appearanceThreadCovers: [
    "/admin/appearance/thread-covers",
    ["admin.appearance"],
  ],
  appearanceThreadCoversNew: [
    "/admin/appearance/thread-covers/new",
    ["admin.appearance"],
  ],
  appearanceThreadCoversEdit: [
    "/admin/appearance/thread-covers/[id]",
    ["admin.appearance"],
  ],
  appearanceAccents: ["/admin/appearance/accents", ["admin.appearance"]],
  appearanceAccentsNew: ["/admin/appearance/accents/new", ["admin.appearance"]],
  appearanceAccentsEdit: [
    "/admin/appearance/accents/[id]",
    ["admin.appearance"],
  ],
  appearanceNameColors: ["/admin/appearance/name-colors", ["admin.appearance"]],
  appearanceNameColorsNew: [
    "/admin/appearance/name-colors/new",
    ["admin.appearance"],
  ],
  appearanceNameColorsEdit: [
    "/admin/appearance/name-colors/[id]",
    ["admin.appearance"],
  ],
  appearancePrefixColors: [
    "/admin/appearance/prefix-colors",
    ["admin.appearance"],
  ],
  appearancePrefixColorsNew: [
    "/admin/appearance/prefix-colors/new",
    ["admin.appearance"],
  ],
  appearancePrefixColorsEdit: [
    "/admin/appearance/prefix-colors/[id]",
    ["admin.appearance"],
  ],
  economyCreditRules: ["/admin/credit-rules", ["admin.creditRules"]],
  economyCredits: ["/admin/credits", ["credits.adjust"]],
  economyAwards: ["/admin/awards", ["admin.awards"]],
  economyAwardEdit: ["/admin/awards/[id]", ["admin.awards"]],
  economyAwardGrants: ["/admin/award-grants", ["award.grant"]],
  economyShopCategories: ["/admin/shop/categories", ["admin.shop"]],
  economyShopItems: ["/admin/shop/items", ["admin.shop"]],
  economyShopItemEdit: ["/admin/shop/items/[id]", ["admin.shop"]],
  moderationHome: ["/moderation", "canModerate"],
  moderationReports: ["/moderation/reports", "canHandleReports"],
  moderationReportCase: ["/moderation/reports/[id]", "canHandleReports"],
  moderationReportMessage: [
    "/moderation/reports/[id]/message",
    ["conversation.moderate"],
  ],
  moderationApprovals: ["/moderation/approvals", "canApprove"],
  moderationApprovalReview: ["/moderation/approvals/[type]/[id]", "canApprove"],
  moderationSignups: ["/moderation/signups", ["member.approveRegistrations"]],
  moderationIps: ["/moderation/ips", ["member.viewIps"]],
  toolsMaintenance: [
    "/admin/tools",
    [
      "credits.adjust",
      "admin.promotions",
      "admin.awards",
      "member.spamCleanup",
    ],
  ],
  toolsModeratorLog: ["/admin/logs/moderator", "canReadModeratorLog"],
  toolsPromotionLog: ["/admin/logs/promotions", ["admin.promotions"]],
  toolsCreditLedger: ["/admin/logs/credits", ["credits.viewAny"]],
  toolsShopPurchases: ["/admin/logs/purchases", ["admin.shop"]],
  toolsTasks: ["/admin/logs/tasks", ["admin.settings"]],
};

// Where each screen sits: every screen of the panel but the landings, each exactly once.
const SECTION_MAP: Record<string, string[]> = {
  home: ["home"],
  setup: [
    "setupGeneral",
    "setupHome",
    "setupMembers",
    "setupAntispam",
    "setupUploads",
    "setupSeo",
    "setupIdentity",
    "setupLevels",
    "setupCookies",
    "setupNavigation",
  ],
  content: [
    "contentReactions",
    "contentReactionNew",
    "contentReactionSort",
    "contentReactionEdit",
    "contentWordFilters",
    "contentTags",
    "contentPages",
    "contentPageEdit",
  ],
  forums: ["forumsTree", "forumsPrefixes", "forumsEdit", "forumsPermissions"],
  communication: [
    "communicationAnnouncements",
    "communicationAnnouncementNew",
    "communicationNotices",
    "communicationNoticeEdit",
    "communicationNotifications",
    "communicationEmail",
  ],
  users: [
    "usersList",
    "usersBatch",
    "usersBans",
    "setupWarnings",
    "usersEdit",
    "usersGroups",
    "usersProfile",
    "usersAppearance",
    "usersPermissions",
    "usersSanctions",
    "usersEconomy",
    "usersSessions",
    "usersHistory",
  ],
  groups: [
    "groupsList",
    "groupsEdit",
    "groupsPromotions",
    "groupsPromotionEdit",
    "permissionsGroups",
    "permissionsGroupEdit",
    "permissionsMembers",
    "permissionsMemberEdit",
    "permissionsForums",
    "permissionsExplain",
    "staffModerators",
    "staffAdministrators",
  ],
  appearance: [
    "appearanceFrames",
    "appearanceFramesNew",
    "appearanceFramesEdit",
    "appearanceCovers",
    "appearanceCoversNew",
    "appearanceCoversEdit",
    "appearanceThreadCovers",
    "appearanceThreadCoversNew",
    "appearanceThreadCoversEdit",
    "appearanceAccents",
    "appearanceAccentsNew",
    "appearanceAccentsEdit",
    "appearanceNameColors",
    "appearanceNameColorsNew",
    "appearanceNameColorsEdit",
    "appearancePrefixColors",
    "appearancePrefixColorsNew",
    "appearancePrefixColorsEdit",
  ],
  economy: [
    "economyCreditRules",
    "economyCredits",
    "economyAwards",
    "economyAwardEdit",
    "economyAwardGrants",
    "economyShopCategories",
    "economyShopItems",
    "economyShopItemEdit",
  ],
  tools: ["toolsMaintenance"],
  logs: [
    "toolsModeratorLog",
    "toolsPromotionLog",
    "toolsCreditLedger",
    "toolsShopPurchases",
    "toolsTasks",
  ],
  moderation: [
    "moderationHome",
    "moderationReports",
    "moderationReportCase",
    "moderationReportMessage",
    "moderationApprovals",
    "moderationApprovalReview",
    "moderationSignups",
    "moderationIps",
  ],
};

test("the twelve sections are there, and every detail screen extends a listed one", () => {
  expect(SECTIONS.map((s) => s.id)).toEqual([
    "home",
    "setup",
    "content",
    "forums",
    "communication",
    "users",
    "groups",
    "appearance",
    "economy",
    "tools",
    "logs",
    "moderation",
  ]);
  for (const screen of SCREENS.filter((s) => s.listed === false)) {
    const parents = SCREENS.filter(
      (other) =>
        other.section === screen.section &&
        other.listed !== false &&
        screen.path.startsWith(`${other.path}/`),
    );
    expect(parents.length, screen.key).toBeGreaterThan(0);
  }
});

test("every screen sits in exactly one section, at its old address and with its old rule", () => {
  // Moderation's landing is a screen it had before: the overview.
  const placed = Object.fromEntries(
    SECTIONS.map((section) => [
      section.id,
      SCREENS.filter(
        (s) =>
          s.section === section.id &&
          (!s.landing || s.key === "moderationHome"),
      ).map((s) => s.key),
    ]),
  );
  expect(placed).toEqual(SECTION_MAP);
  const keys = Object.values(SECTION_MAP).flat();
  expect(new Set(keys).size).toBe(keys.length);
  expect([...keys].sort()).toEqual(Object.keys(GATES_BEFORE).sort());
  for (const key of keys) {
    const screen = SCREENS.find((s) => s.key === key);
    const rule =
      typeof screen?.access === "function"
        ? screen.access.name
        : [...(screen?.access ?? [])];
    expect([screen?.path, rule], key).toEqual(GATES_BEFORE[key]);
    expect(screen?.built, key).toBe(true);
  }
});

test("each section but the home has one landing, at an address of its own that opens for whoever opens one of its screens", () => {
  const people = [
    member,
    singleForumModerator,
    announcer,
    settingsAdmin,
    grantor,
    moderator,
    administrator,
    standing(["member.viewIps"]),
    standing(["moderatorLog.view"]),
  ];
  for (const section of SECTIONS) {
    const landings = SCREENS.filter(
      (s) => s.section === section.id && s.landing,
    );
    if (section.id === "home") {
      expect(landings).toEqual([]);
      continue;
    }
    expect(landings.length, section.id).toBe(1);
    const [landing] = landings;
    if (section.id === "moderation") {
      expect(landing.key).toBe("moderationHome");
      continue;
    }
    expect(landing.path).toBe(`/admin/sections/${section.id}`);
    expect(screenAt(landing.path)?.key).toBe(landing.key);
    for (const me of people) {
      const opensOne = SCREENS.some(
        (s) =>
          s.section === section.id &&
          !s.landing &&
          s.listed !== false &&
          may(me, sampleOf(s.path)),
      );
      expect(may(me, landing.path), `${section.id}`).toBe(opensOne);
    }
  }
  expect(may(settingsAdmin, "/admin/sections/setup")).toBe(true);
  // The warning settings sit with the members.
  expect(may(settingsAdmin, "/admin/sections/users")).toBe(true);
  expect(may(settingsAdmin, "/admin/sections/economy")).toBe(false);
  expect(may(announcer, "/admin/sections/communication")).toBe(true);
  expect(screenAt("/admin/sections")).toBeUndefined();
  expect(screenAt("/admin/sections/home")).toBeUndefined();
  expect(screenAt("/admin/sections/other")).toBeUndefined();
});

test("an address finds its screen, a static path before a dynamic one", () => {
  expect(screenAt("/admin")?.key).toBe("home");
  expect(screenAt("/admin/")?.key).toBe("home");
  expect(screenAt("/admin/forums/prefixes")?.key).toBe("forumsPrefixes");
  expect(screenAt("/admin/forums/12")?.key).toBe("forumsEdit");
  expect(screenAt("/admin/forums/12/permissions")?.key).toBe(
    "forumsPermissions",
  );
  expect(screenAt("/moderation/approvals/post/9")?.key).toBe(
    "moderationApprovalReview",
  );
  for (const path of [
    "/admin/does-not-exist",
    "/admin/forums/0",
    "/admin/forums/012",
    "/admin/forums/1e3",
    "/admin/forums/12/other",
    "/admin/forums/12/permissions/extra",
    "/moderation/nothing",
    "/admin/users/5/groups/x",
    "/admin/users/99999999999999999999",
    "/admin/pages/a.png",
    "/admin/pages/a b",
  ]) {
    expect(screenAt(path), path).toBeUndefined();
  }
});

test("a screen that is not built is never reachable, whoever asks", () => {
  const unbuilt = compile([
    { key: "a", path: "/admin/a", access: [], built: false },
    { key: "b", path: "/admin/b", access: ["admin.settings"], built: false },
  ] satisfies Screen[]);
  expect(mayOpenPath(administrator, "/admin/b", unbuilt)).toBe(false);
  expect(mayOpenPath(administrator, "/admin/c", unbuilt)).toBe(false);
});

test("a member with nothing in the panel opens nothing", () => {
  for (const screen of SCREENS) {
    const path = sampleOf(screen.path);
    // The sample must be an address of this very screen, or the check below proves nothing.
    expect(screenAt(path, everything)?.key, screen.key).toBe(screen.key);
    expect(may(member, path), screen.key).toBe(false);
  }
});

test("a moderator of one forum opens the moderation screens and nothing of administration", () => {
  expect(may(singleForumModerator, "/moderation")).toBe(true);
  expect(may(singleForumModerator, "/moderation/reports")).toBe(true);
  expect(may(singleForumModerator, "/moderation/approvals")).toBe(true);
  expect(may(singleForumModerator, "/moderation/reports/4/message")).toBe(
    false,
  );
  expect(may(singleForumModerator, "/admin/logs/moderator")).toBe(true);
  expect(may(singleForumModerator, "/admin")).toBe(true);
  expect(may(singleForumModerator, "/admin/settings")).toBe(false);
  expect(may(singleForumModerator, "/admin/forums")).toBe(false);
  expect(may(singleForumModerator, "/admin/users")).toBe(false);
});

test("a member whose only staff permission is outside the panel's categories still opens the panel home", () => {
  expect(grantor.staff.panel).toBe(false);
  expect(may(grantor, "/admin")).toBe(true);
  expect(may(grantor, "/admin/award-grants")).toBe(true);
  expect(may(grantor, "/admin/awards")).toBe(false);
  expect(may(grantor, "/admin/settings")).toBe(false);
  expect(may(grantor, "/moderation")).toBe(false);
  expect(
    visibleSections(grantor).map((s) => [
      s.id,
      s.screens.map((screen) => screen.key),
    ]),
  ).toEqual([
    ["home", ["home"]],
    ["economy", ["economyAwardGrants"]],
  ]);
  expect(visibleSections(grantor)[1].landing?.key).toBe("economyLanding");
});

test("the home stays closed to a member with no panel and no screen to open", () => {
  const nothing = standing(["forum.reply", "award.grantable"], {
    panel: false,
  });
  expect(may(nothing, "/admin")).toBe(false);
  expect(visibleSections(nothing)).toEqual([]);
});

test("a partial administrator opens only the sections their permissions name", () => {
  expect(may(announcer, "/admin")).toBe(true);
  expect(may(announcer, "/admin/announcements")).toBe(true);
  expect(may(announcer, "/admin/announcements/new")).toBe(true);
  expect(may(announcer, "/admin/settings")).toBe(false);
  expect(may(announcer, "/admin/users")).toBe(false);
  expect(may(announcer, "/moderation")).toBe(false);
  expect(may(settingsAdmin, "/admin/settings/seo")).toBe(true);
  expect(may(settingsAdmin, "/admin/announcements")).toBe(false);
  expect(may(settingsAdmin, "/admin/logs/tasks")).toBe(true);
});

test("the navigation of a member lists only the built screens they may open", () => {
  expect(visibleSections(member)).toEqual([]);
  expect(visibleSections(announcer).map((s) => s.id)).toEqual([
    "home",
    "communication",
  ]);
  expect(
    visibleSections(singleForumModerator).map((s) => [
      s.id,
      s.screens.map((screen) => screen.key),
    ]),
  ).toEqual([
    ["home", ["home"]],
    ["logs", ["toolsModeratorLog"]],
    ["moderation", ["moderationReports", "moderationApprovals"]],
  ]);
  // The landing of a section is its heading's link, not one of its screens.
  expect(
    visibleSections(singleForumModerator).map((s) => s.landing?.key),
  ).toEqual([undefined, "logsLanding", "moderationHome"]);
});

test("a section whose landing alone opens is still shown, and one whose landing is closed shows its screens", () => {
  // The moderator log opens the moderation overview, and no queue.
  const logReader = standing(["moderatorLog.view"]);
  const moderation = visibleSections(logReader).find(
    (s) => s.id === "moderation",
  );
  expect(moderation?.landing?.key).toBe("moderationHome");
  expect(moderation?.screens).toEqual([]);
  // The IP screen opens without the overview.
  const ipReader = standing(["member.viewIps"]);
  const ips = visibleSections(ipReader).find((s) => s.id === "moderation");
  expect(ips?.landing).toBeUndefined();
  expect(ips?.screens.map((s) => s.key)).toEqual(["moderationIps"]);
});

test("a moderator everywhere and a full administrator open the moderation screens", () => {
  for (const me of [moderator, administrator]) {
    expect(may(me, "/moderation/reports")).toBe(true);
    expect(may(me, "/moderation/approvals/post/9")).toBe(true);
  }
  expect(may(moderator, "/admin/settings")).toBe(false);
  expect(may(administrator, "/admin/settings")).toBe(true);
  expect(may(administrator, "/admin/permissions/explain")).toBe(true);
  expect(may(administrator, "/admin/users/12/economy")).toBe(true);
});

test("the sign-up queue opens for the permission alone, and the batch screen for the members permission", () => {
  const reviewer = standing(["member.approveRegistrations"]);
  expect(may(reviewer, "/moderation")).toBe(true);
  expect(may(reviewer, "/moderation/signups")).toBe(true);
  expect(may(reviewer, "/moderation/reports")).toBe(false);
  expect(may(reviewer, "/moderation/approvals")).toBe(false);
  expect(may(singleForumModerator, "/moderation/signups")).toBe(false);
  expect(
    visibleSections(reviewer).map((s) => [s.id, s.screens.map((x) => x.key)]),
  ).toContainEqual(["moderation", ["moderationSignups"]]);
  expect(
    visibleSections(reviewer).find((s) => s.id === "moderation")?.landing?.key,
  ).toBe("moderationHome");
  expect(screenAt("/admin/users/batch")?.key).toBe("usersBatch");
  expect(screenAt("/admin/users/7")?.key).toBe("usersEdit");
  const members = standing(["admin.members"]);
  expect(may(members, "/admin/users/batch")).toBe(true);
  expect(may(reviewer, "/admin/users/batch")).toBe(false);
  // A form behind the members list: gated like the others, not in the navigation.
  expect(
    visibleSections(members)
      .flatMap((section) => section.screens.map((x) => x.key))
      .includes("usersBatch" as never),
  ).toBe(false);
});

const trail = (me: Standing, path: string) =>
  trailOf(me, path).map(({ screen, href }) => [screen.key, href]);

test("the trail of an address leads up through the home, the section's landing and the screens above it", () => {
  expect(trail(administrator, "/admin")).toEqual([]);
  expect(trail(administrator, "/admin/sections/users")).toEqual([
    ["home", "/admin"],
  ]);
  expect(trail(administrator, "/admin/users")).toEqual([
    ["home", "/admin"],
    ["usersLanding", "/admin/sections/users"],
  ]);
  expect(trail(administrator, "/admin/users/7/groups")).toEqual([
    ["home", "/admin"],
    ["usersLanding", "/admin/sections/users"],
    ["usersList", "/admin/users"],
    ["usersEdit", "/admin/users/7"],
  ]);
  // A screen above the address in another section is not on the way up.
  expect(trail(administrator, "/admin/settings/warnings")).toEqual([
    ["home", "/admin"],
    ["usersLanding", "/admin/sections/users"],
  ]);
  // A listed screen under another's address is its sibling.
  for (const path of ["/admin/settings/seo", "/admin/forums/prefixes"]) {
    expect(
      trail(administrator, path).map(([key]) => key),
      path,
    ).toEqual([
      "home",
      path.includes("settings") ? "setupLanding" : "forumsLanding",
    ]);
  }
  expect(trail(administrator, "/admin/forums/7/permissions")).toEqual([
    ["home", "/admin"],
    ["forumsLanding", "/admin/sections/forums"],
    ["forumsTree", "/admin/forums"],
    ["forumsEdit", "/admin/forums/7"],
  ]);
  expect(trail(administrator, "/admin/logs/moderator")).toEqual([
    ["home", "/admin"],
    ["logsLanding", "/admin/sections/logs"],
  ]);
  expect(trail(moderator, "/moderation/reports/4")).toEqual([
    ["home", "/admin"],
    ["moderationHome", "/moderation"],
    ["moderationReports", "/moderation/reports"],
  ]);
  expect(trail(administrator, "/admin/nothing-here")).toEqual([]);
});

test("the trail leaves out what the member may not open", () => {
  // Credits open a member's economy tab, not the member list or the member.
  const ledger = standing(["credits.viewAny"]);
  expect(trail(ledger, "/admin/users/7/economy")).toEqual([["home", "/admin"]]);
});

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "page.tsx" || entry.name === "route.ts" ? [path] : [];
  });
}

const STAFF_ROOT = join(import.meta.dir);

// The address a route file serves: route groups leave the path, a dynamic folder keeps its name.
const addressOf = (file: string) => {
  const parts = relative(STAFF_ROOT, join(file, ".."))
    .split(sep)
    .filter((part) => part !== "" && !/^\(.*\)$/.test(part));
  return `/${parts.join("/")}`;
};

test("every page and route of the panel is a screen of the registry", () => {
  const known = new Set(SCREENS.map((screen) => screen.path));
  const found = routeFiles(STAFF_ROOT).map(addressOf);
  expect(found.length).toBeGreaterThan(50);
  for (const address of found) {
    expect(known.has(address), address).toBe(true);
  }
});

test("every screen marked built has a route file", () => {
  const found = new Set(routeFiles(STAFF_ROOT).map(addressOf));
  for (const screen of SCREENS.filter((s) => s.built)) {
    expect(found.has(screen.path), screen.key).toBe(true);
  }
});
