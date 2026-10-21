import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import type { Actor } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import { ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { can } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";

// The administration writes of the site's catalogs decide again inside their transaction: an
// administrator whose permission was withdrawn by another process after their request was
// resolved changes nothing.

const run = (ctx: Ctx, name: string, actor: Actor, input: object = {}) =>
  // biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
  execute(ctx, getOperation(name), actor, input) as Promise<any>;

const PERMISSIONS = [
  "admin.navigation",
  "admin.announcements",
  "admin.pages",
  "admin.prefixes",
  "admin.nodes",
  "admin.permissions",
];
const entries = (value: "allow" | "unset") =>
  PERMISSIONS.map((permission) => ({ permission, value }));

async function scenario() {
  const fixture = createTestContext();
  const founder = userActor(insertUser(fixture, { groupId: 4 }));
  const group = (await run(fixture, "groups.create", founder, { title: "Editors", rank: 40 })) as {
    id: number;
  };
  await run(fixture, "permissions.set", founder, {
    groupId: group.id,
    entries: [...entries("allow"), { permission: "node.view", value: "allow" }],
  });
  const editor = insertUser(fixture, { groupId: group.id });
  const member = insertUser(fixture);
  const category = insertNode(fixture, { type: "category" });
  const forum = insertNode(fixture, { parentId: category.id });
  invalidate(fixture, "node_tree");
  const color = fixture.sqlite
    .prepare<{ id: number }, []>(
      "SELECT id FROM palette_colors WHERE kind = 'prefix' AND is_active = 1 ORDER BY position LIMIT 1",
    )
    .get()!.id;
  const entry = await run(fixture, "navigation.create", founder, {
    location: "header",
    title: "Home",
    target: "/",
  });
  const notice = await run(fixture, "notices.create", founder, { ...NOTICE });
  await run(fixture, "pages.save", founder, { slug: "faq", title: "FAQ", body: "Text" });
  const prefix = await run(fixture, "threadPrefixes.create", founder, {
    label: "Help",
    colorId: color,
  });
  const tab = await run(fixture, "forumTabs.create", founder, { title: "Main" });
  const database = sharedDatabase(fixture);
  const here = database.open();
  const elsewhere = database.open();
  const actor = resolvedActor(here, editor.id);
  expect(can(here, actor, "admin.pages")).toBe(true);
  return {
    database,
    here,
    elsewhere,
    actor,
    founder,
    group,
    member,
    forumId: forum.id,
    color,
    entryId: entry.id as number,
    noticeId: notice.id as number,
    prefixId: prefix.id as number,
    tabId: tab.id as number,
  };
}
type Scenario = Awaited<ReturnType<typeof scenario>>;

const NOTICE = {
  title: "Notice",
  body: "Hello",
  rule: { match: "all", conditions: [] },
  dismissible: true,
  active: true,
  startsAt: null,
  endsAt: null,
};

const attempts: Record<string, (ctx: Ctx, actor: Actor, s: Scenario) => Promise<unknown>> = {
  "navigation.create": (ctx, actor) =>
    run(ctx, "navigation.create", actor, { location: "header", title: "New", target: "/new" }),
  "navigation.update": (ctx, actor, s) =>
    run(ctx, "navigation.update", actor, { entryId: s.entryId, title: "Changed" }),
  "navigation.delete": (ctx, actor, s) =>
    run(ctx, "navigation.delete", actor, { entryId: s.entryId }),
  "notices.create": (ctx, actor) => run(ctx, "notices.create", actor, { ...NOTICE }),
  "notices.update": (ctx, actor, s) =>
    run(ctx, "notices.update", actor, { noticeId: s.noticeId, ...NOTICE, title: "Changed" }),
  "notices.delete": (ctx, actor, s) => run(ctx, "notices.delete", actor, { noticeId: s.noticeId }),
  "pages.save": (ctx, actor) =>
    run(ctx, "pages.save", actor, { slug: "faq", title: "Changed", body: "New text" }),
  "pages.delete": (ctx, actor) => run(ctx, "pages.delete", actor, { slug: "faq" }),
  "threadPrefixes.create": (ctx, actor, s) =>
    run(ctx, "threadPrefixes.create", actor, { label: "Other", colorId: s.color }),
  "threadPrefixes.update": (ctx, actor, s) =>
    run(ctx, "threadPrefixes.update", actor, { prefixId: s.prefixId, label: "Changed" }),
  "threadPrefixes.delete": (ctx, actor, s) =>
    run(ctx, "threadPrefixes.delete", actor, { prefixId: s.prefixId }),
  "forumTabs.create": (ctx, actor) => run(ctx, "forumTabs.create", actor, { title: "Other" }),
  "forumTabs.update": (ctx, actor, s) =>
    run(ctx, "forumTabs.update", actor, { tabId: s.tabId, title: "Changed" }),
  "forumTabs.delete": (ctx, actor, s) => run(ctx, "forumTabs.delete", actor, { tabId: s.tabId }),
  "nodes.create": (ctx, actor) =>
    run(ctx, "nodes.create", actor, { parentId: null, type: "category", title: "New" }),
  "nodes.update": (ctx, actor, s) =>
    run(ctx, "nodes.update", actor, { nodeId: s.forumId, title: "Changed" }),
  "nodes.setModerator": (ctx, actor, s) =>
    run(ctx, "nodes.setModerator", actor, { nodeId: s.forumId, userId: s.member.id }),
};

const snapshot = (ctx: Ctx) =>
  JSON.stringify(
    [
      "SELECT id, title, target, is_enabled FROM navigation_entries ORDER BY id",
      "SELECT id, title FROM notices ORDER BY id",
      "SELECT id, slug, title, version FROM static_pages ORDER BY id",
      "SELECT id, label, is_active FROM thread_prefixes ORDER BY id",
      "SELECT id, title FROM forum_tabs ORDER BY id",
      "SELECT id, parent_id, title FROM nodes ORDER BY id",
      "SELECT id, user_id, permission_id, node_id FROM permission_entries ORDER BY id",
      "SELECT id, action FROM moderator_log ORDER BY id",
    ].map((sql) => ctx.sqlite.prepare(sql).all()),
  );

for (const [name, attempt] of Object.entries(attempts))
  test(`${name} is refused to an administrator whose permission was withdrawn meanwhile`, async () => {
    const s = await scenario();
    try {
      await run(s.elsewhere, "permissions.set", s.founder, {
        groupId: s.group.id,
        entries: entries("unset"),
      });
      const before = snapshot(s.elsewhere);
      await expect(attempt(s.here, s.actor, s)).rejects.toThrow(ForbiddenError);
      expect(snapshot(s.elsewhere)).toBe(before);
    } finally {
      s.database.close();
    }
  });

test("an administrator whose permission stands still does all of them from a second process", async () => {
  const s = await scenario();
  try {
    for (const attempt of Object.values(attempts)) await attempt(s.here, s.actor, s);
  } finally {
    s.database.close();
  }
});
