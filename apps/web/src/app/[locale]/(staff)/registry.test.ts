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

test("the eleven sections are there, and every detail screen extends a listed one", () => {
  expect(SECTIONS.map((s) => s.id)).toEqual([
    "home",
    "setup",
    "forums",
    "content",
    "communication",
    "users",
    "groups",
    "appearance",
    "economy",
    "moderation",
    "tools",
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
    [
      "moderation",
      ["moderationHome", "moderationReports", "moderationApprovals"],
    ],
    ["tools", ["toolsModeratorLog"]],
  ]);
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
