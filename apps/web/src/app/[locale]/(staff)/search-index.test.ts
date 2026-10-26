import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "use-intl";
import { messages } from "@/i18n/messages";
import { PERMISSIONS } from "../../../../../../packages/core/src/permissions/registry";
import { type Standing, visibleSections } from "./registry";
import { buildSearchIndex, type SearchDefinition } from "./search-index";
import { searchEntries } from "./search-match";

const standing = (
  held: string[] = [],
  staff: Partial<Standing["staff"]> = {},
): Standing => ({
  resolvedPermissions: Object.fromEntries(held.map((id) => [id, true])),
  staff: {
    panel: true,
    moderatesEverywhere: false,
    moderatedNodeIds: [],
    ...staff,
  },
});

const administrator = standing(
  Object.keys(PERMISSIONS).filter((id) => id.startsWith("admin.")),
  { moderatesEverywhere: true },
);
const moderator = standing(["moderation.access"], {
  moderatesEverywhere: true,
});

const DEFINITIONS: SearchDefinition[] = [
  {
    id: "forum.guestPost",
    scope: "node",
    title: "Post as a guest",
    help: "Start threads and reply without an account.",
    categoryTitle: "Forum",
  },
  {
    id: "conversation.start",
    scope: "global",
    title: "Start conversations",
    help: "",
    categoryTitle: "Conversations",
  },
];

const translate = createTranslator({ locale: "en", messages });
const t = (key: string) => translate(key as never);

const index = (viewer: Standing) =>
  buildSearchIndex({ viewer, t, definitions: DEFINITIONS });

const first = (viewer: Standing, query: string) =>
  searchEntries(index(viewer), query)[0]?.entry;

test("a screen is found by its label, with its section as the path", () => {
  const found = first(administrator, "anti-spam");
  expect(found).toMatchObject({
    kind: "screen",
    label: "Anti-spam",
    path: ["Setup"],
    href: "/admin/settings/antispam",
  });
});

test('"turnstile" finds the field on the anti-spam screen, opened at that row', () => {
  const found = first(administrator, "turnstile");
  expect(found).toMatchObject({
    kind: "setting",
    id: "turnstileEnabled",
    path: ["Setup", "Anti-spam"],
    href: "/admin/settings/antispam?setting=turnstileEnabled",
  });
  // The id of a setting is enough.
  expect(first(administrator, "turnstileSiteKey")?.href).toBe(
    "/admin/settings/antispam?setting=turnstileSiteKey",
  );
});

test('"guestPost" finds the permission on the forum permissions screen, opened on it', () => {
  const found = first(administrator, "guestPost");
  expect(found).toMatchObject({
    kind: "permission",
    label: "Post as a guest",
    path: [
      "Groups and permissions",
      "Permissions",
      "Forum permissions",
      "Forum",
    ],
    href: "/admin/permissions/forums?permission=forum.guestPost",
  });
  // A permission of the global scope opens on the group permissions.
  expect(first(administrator, "conversation.start")?.href).toBe(
    "/admin/permissions/groups?permission=conversation.start",
  );
});

test("a moderator without admin permissions finds only the screens they may open", () => {
  const entries = index(moderator);
  expect(entries.length).toBeGreaterThan(0);
  // The very screens the navigation lists for them: the moderation queues and the moderator log.
  const listed = visibleSections(moderator).flatMap((section) => [
    ...(section.landing ? [section.landing.path] : []),
    ...section.screens.map((screen) => screen.path),
  ]);
  expect(entries.map((entry) => entry.href).sort()).toEqual(listed.sort());
  for (const entry of entries) {
    expect(entry.kind).toBe("screen");
    expect(entry.href).not.toMatch(/^\/admin\/(settings|permissions)/);
  }
  expect(first(moderator, "turnstile")).toBeUndefined();
  expect(first(moderator, "guestPost")).toBeUndefined();
});

test("settings come with the settings permission alone, and permissions with the permissions one", () => {
  const settings = index(standing(["admin.settings"]));
  expect(settings.some((entry) => entry.kind === "setting")).toBe(true);
  expect(settings.some((entry) => entry.kind === "permission")).toBe(false);
  const permissions = index(standing(["admin.permissions"]));
  expect(permissions.some((entry) => entry.kind === "setting")).toBe(false);
  expect(permissions.some((entry) => entry.kind === "permission")).toBe(true);
});

test("no screen that is not built or not listed is found", () => {
  const hrefs = index(administrator).map((entry) => entry.href);
  for (const href of hrefs) expect(href).not.toContain("[");
  expect(hrefs).not.toContain("/admin/settings/navigation/new");
});

test("a guest finds nothing", () => {
  const guest: Standing = {
    resolvedPermissions: {},
    staff: { panel: false, moderatesEverywhere: false, moderatedNodeIds: [] },
  };
  expect(index(guest)).toEqual([]);
});

test("every permission has a searchable label in every language", () => {
  const locales = join(
    import.meta.dir,
    "../../../../../../packages/core/src/i18n/locales",
  );
  for (const language of ["en", "es"]) {
    const phrases = JSON.parse(
      readFileSync(join(locales, `${language}.json`), "utf8"),
    ) as Record<string, string>;
    for (const id of Object.keys(PERMISSIONS))
      expect(phrases[`permission.${id}`], `${language}: ${id}`).toBeTruthy();
  }
});
