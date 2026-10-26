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
  buildSearchIndex({ viewer, t, definitions: async () => DEFINITIONS });

const first = async (viewer: Standing, query: string) =>
  searchEntries(await index(viewer), query)[0]?.entry;

test("a screen is found by its label, with its section as the path", async () => {
  const found = await first(administrator, "anti-spam");
  expect(found).toMatchObject({
    kind: "screen",
    label: "Anti-spam",
    path: ["Setup"],
    href: "/admin/settings/antispam",
  });
});

test('"turnstile" finds the field on the anti-spam screen, opened at that row', async () => {
  const found = await first(administrator, "turnstile");
  expect(found).toMatchObject({
    kind: "setting",
    id: "turnstileEnabled",
    // The card the row sits in ends the path.
    path: ["Setup", "Anti-spam", "Cloudflare Turnstile"],
    href: "/admin/settings/antispam?setting=turnstileEnabled",
  });
  // The id of a setting is enough.
  expect((await first(administrator, "turnstileSiteKey"))?.href).toBe(
    "/admin/settings/antispam?setting=turnstileSiteKey",
  );
});

test('"guestPost" finds the permission on the forum permissions screen, opened on it', async () => {
  const found = await first(administrator, "guestPost");
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
  expect((await first(administrator, "conversation.start"))?.href).toBe(
    "/admin/permissions/groups?permission=conversation.start",
  );
});

test("a moderator without admin permissions finds only the screens they may open", async () => {
  const entries = await index(moderator);
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
  expect(await first(moderator, "turnstile")).toBeUndefined();
  expect(await first(moderator, "guestPost")).toBeUndefined();
});

test("settings come with the settings permission alone, and permissions with the permissions one", async () => {
  const settings = await index(standing(["admin.settings"]));
  expect(settings.some((entry) => entry.kind === "setting")).toBe(true);
  expect(settings.some((entry) => entry.kind === "permission")).toBe(false);
  const permissions = await index(standing(["admin.permissions"]));
  expect(permissions.some((entry) => entry.kind === "setting")).toBe(false);
  expect(permissions.some((entry) => entry.kind === "permission")).toBe(true);
});

test("no screen that is not built or not listed is found", async () => {
  const hrefs = (await index(administrator)).map((entry) => entry.href);
  for (const href of hrefs) expect(href).not.toContain("[");
  expect(hrefs).not.toContain("/admin/settings/navigation/new");
});

test("a guest finds nothing", async () => {
  const guest: Standing = {
    resolvedPermissions: {},
    staff: { panel: false, moderatesEverywhere: false, moderatedNodeIds: [] },
  };
  expect(await index(guest)).toEqual([]);
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

test("a row whose label means little alone is placed by its card, whose words also find it", async () => {
  const subject = await first(administrator, "welcome subject");
  expect(subject).toMatchObject({
    label: "Subject",
    path: ["Setup", "New members", "Welcome message"],
    href: "/admin/settings/members?setting=welcomeMessage.subject",
  });
  // A row named after its card does not repeat it.
  expect((await first(administrator, "allowed file types"))?.path).toEqual([
    "Setup",
    "Uploads",
  ]);
});

test("the permission definitions are asked for only when a permission screen is open to the viewer", async () => {
  let asked = 0;
  const count = async () => {
    asked++;
    return DEFINITIONS;
  };
  await buildSearchIndex({ viewer: moderator, t, definitions: count });
  await buildSearchIndex({
    viewer: standing(["admin.settings"]),
    t,
    definitions: count,
  });
  expect(asked).toBe(0);
  await buildSearchIndex({ viewer: administrator, t, definitions: count });
  expect(asked).toBe(1);
});

test("the write-only Turnstile secret is no search result; the site key still is", async () => {
  const entries = await index(administrator);
  expect(entries.some((entry) => /secret/i.test(entry.id))).toBe(false);
  expect(entries.some((entry) => entry.id === "turnstileSiteKey")).toBe(true);
});
