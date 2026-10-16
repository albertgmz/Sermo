import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { NAVIGATION_LIMIT, navigationSql } from "./index";

const run = (ctx: Ctx, name: string, actor: Parameters<typeof execute>[2], input: object = {}) =>
  // biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
  execute(ctx, getOperation(name), actor, input) as Promise<any>;

function setup() {
  const ctx = createTestContext();
  const adminUser = insertUser(ctx, { groupId: 4 });
  const admin = userActor(adminUser);
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const memberUser = insertUser(ctx);
  const member = userActor(memberUser);
  const token = tokenActor(memberUser);
  const create = (input: object, actor = admin) =>
    run(ctx, "navigation.create", actor, {
      location: "header",
      title: "Link",
      target: "/x",
      ...input,
    });
  const entryId = (builtin: string) =>
    ctx.sqlite
      .prepare<{ id: number }, [string]>("SELECT id FROM navigation_entries WHERE builtin = ?1")
      .get(builtin)!.id;
  const titles = (view: { title: string }[]) => view.map((link) => link.title);
  return { ctx, admin, moderator, member, token, create, entryId, titles };
}

describe("navigation.get", () => {
  test("a guest sees the shipped links of their audience, in order, children nested", async () => {
    const { ctx, titles } = setup();
    const view = await run(ctx, "navigation.get", GUEST);
    expect(titles(view.header)).toEqual(["Home", "Forums", "Members", "Awards", "Credits"]);
    expect(titles(view.mobile)).toEqual(["Home", "Log in"]);
    expect(view.account).toEqual([]);
    expect(titles(view.footer)).toEqual(["Community", "Useful", "Legal"]);
    expect(titles(view.footer[2].children)).toEqual([
      "Terms",
      "Privacy",
      "Legal notice",
      "Contact",
    ]);
    expect(Object.keys(view.header[0]).sort()).toEqual([
      "builtin",
      "children",
      "icon",
      "iconPosition",
      "id",
      "target",
      "title",
    ]);
    expect(Object.keys(view.footer[0].children[0]).sort()).toEqual([
      "builtin",
      "icon",
      "iconPosition",
      "id",
      "target",
      "title",
    ]);
  });

  test("a member (and a token) sees member entries and not guest entries", async () => {
    const { ctx, member, token, titles } = setup();
    for (const actor of [member, token]) {
      const view = await run(ctx, "navigation.get", actor);
      expect(titles(view.mobile)).toEqual(["Home", "Messages", "Alerts", "Profile"]);
      expect(titles(view.account)).toEqual(["Profile", "Account", "Upgrade"]);
    }
  });

  test("an unconfirmed member sees what a member sees; a banned member too, except entries gated on a permission", async () => {
    const { ctx, admin, member, create, titles } = setup();
    await create({ title: "Reply", audience: "permission", permission: "notification.view" });
    const unconfirmed = userActor(insertUser(ctx, { groupId: 5 }));
    const bannedUser = insertUser(ctx);
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(bannedUser.id);
    const banned = userActor(bannedUser);
    const asMember = await run(ctx, "navigation.get", member);
    for (const actor of [unconfirmed, banned]) {
      const view = await run(ctx, "navigation.get", actor);
      expect(titles(view.mobile)).toEqual(titles(asMember.mobile));
      expect(titles(view.account)).toEqual(titles(asMember.account));
      expect(titles(view.footer)).toEqual(titles(asMember.footer));
    }
    expect(titles(asMember.header)).toContain("Reply");
    expect(titles((await run(ctx, "navigation.get", unconfirmed)).header)).toEqual(
      titles(asMember.header),
    );
    expect(titles((await run(ctx, "navigation.get", banned)).header)).toEqual(
      titles(asMember.header).filter((title: string) => title !== "Reply"),
    );
    expect(titles((await run(ctx, "navigation.get", admin)).header)).toContain("Reply");
  });

  test("an entry gated on a permission shows to holders only", async () => {
    const { ctx, admin, member, moderator, create } = setup();
    await create({ title: "Staff", audience: "permission", permission: "admin.settings" });
    await create({ title: "Reply", audience: "permission", permission: "notification.view" });
    const names = async (actor: Parameters<typeof execute>[2]) =>
      (await run(ctx, "navigation.get", actor)).header.map((link: { title: string }) => link.title);
    expect(await names(admin)).toContain("Staff");
    expect(await names(member)).not.toContain("Staff");
    expect(await names(moderator)).not.toContain("Staff");
    expect(await names(GUEST)).not.toContain("Staff");
    expect(await names(member)).toContain("Reply");
    expect(await names(GUEST)).not.toContain("Reply");
  });

  test("an entry whose permission is no longer registered is hidden from everyone", async () => {
    const { ctx, admin, create } = setup();
    const entry = await create({
      title: "Gone",
      audience: "permission",
      permission: "admin.settings",
    });
    ctx.sqlite
      .prepare("UPDATE navigation_entries SET permission = 'removed.permission' WHERE id = ?1")
      .run(entry.id);
    ctx.caches.clear();
    const view = await run(ctx, "navigation.get", admin);
    expect(view.header.map((link: { title: string }) => link.title)).not.toContain("Gone");
  });

  test("a disabled parent hides its children and a disabled child is left out", async () => {
    const { ctx, admin, entryId, titles } = setup();
    await run(ctx, "navigation.update", admin, {
      entryId: entryId("footer.legal.terms"),
      isEnabled: false,
    });
    let view = await run(ctx, "navigation.get", GUEST);
    expect(titles(view.footer[2].children)).toEqual(["Privacy", "Legal notice", "Contact"]);
    await run(ctx, "navigation.update", admin, {
      entryId: entryId("footer.legal"),
      isEnabled: false,
    });
    view = await run(ctx, "navigation.get", GUEST);
    expect(titles(view.footer)).toEqual(["Community", "Useful"]);
  });

  test("a heading with no visible child is omitted, a link with no children is kept", async () => {
    const { ctx, admin, create, titles } = setup();
    const heading = await create({ location: "footer", title: "Empty", target: null });
    let view = await run(ctx, "navigation.get", GUEST);
    expect(titles(view.footer)).not.toContain("Empty");
    await create({
      location: "footer",
      parentId: heading.id,
      title: "Members only",
      audience: "members",
    });
    view = await run(ctx, "navigation.get", GUEST);
    expect(titles(view.footer)).not.toContain("Empty");
    view = await run(ctx, "navigation.get", admin);
    expect(titles(view.footer)).toContain("Empty");
    expect(titles(view.header)).toContain("Home");
  });

  test("entries are ordered by position, then id", async () => {
    const { ctx, create, titles } = setup();
    await create({ location: "account", title: "B", position: 5 });
    await create({ location: "account", title: "A", position: 5 });
    await create({ location: "account", title: "First", position: 0 });
    const view = await run(ctx, "navigation.get", GUEST);
    expect(titles(view.account)).toEqual(["First", "B", "A"]);
  });

  test("when warm it runs no query, and a write shows at once", async () => {
    const { ctx, admin, create, titles } = setup();
    await run(ctx, "navigation.get", GUEST);
    const prepared: string[] = [];
    const prepare = ctx.sqlite.prepare.bind(ctx.sqlite);
    ctx.sqlite.prepare = ((sql: string) => {
      prepared.push(sql);
      return prepare(sql);
    }) as typeof ctx.sqlite.prepare;
    await run(ctx, "navigation.get", GUEST);
    expect(prepared.filter((sql) => sql.includes("navigation_entries"))).toEqual([]);
    ctx.sqlite.prepare = prepare as never;
    await create({ title: "Fresh" });
    expect(titles((await run(ctx, "navigation.get", GUEST)).header)).toContain("Fresh");
    const created = (await run(ctx, "navigation.list", admin)).items.find(
      (entry: { title: string }) => entry.title === "Fresh",
    );
    await run(ctx, "navigation.update", admin, { entryId: created.id, title: "Renamed" });
    expect(titles((await run(ctx, "navigation.get", GUEST)).header)).toContain("Renamed");
    await run(ctx, "navigation.delete", admin, { entryId: created.id });
    expect(titles((await run(ctx, "navigation.get", GUEST)).header)).not.toContain("Renamed");
  });

  test("another context sees a write through the cache version", async () => {
    const { ctx, create, titles } = setup();
    await run(ctx, "navigation.get", GUEST);
    await create({ title: "Elsewhere" });
    ctx.caches.clear();
    expect(titles((await run(ctx, "navigation.get", GUEST)).header)).toContain("Elsewhere");
  });

  test("the rebuild query uses an index", () => {
    const { ctx } = setup();
    expectNoTableScan(ctx, navigationSql.one, [1]);
    expectNoTableScan(ctx, navigationSql.hasChildren, ["footer", 1]);
  });
});

describe("navigation administration: permissions", () => {
  const calls = (entryId: number): [string, object][] => [
    ["navigation.list", {}],
    ["navigation.create", { location: "header", title: "X", target: "/x" }],
    ["navigation.update", { entryId, title: "Y" }],
    ["navigation.delete", { entryId }],
  ];

  test("guests, members and moderators are refused, an administrator is served", async () => {
    const { ctx, admin, moderator, member, token, create } = setup();
    const entry = await create({ title: "Mine" });
    for (const [name, input] of calls(entry.id)) {
      await expect(run(ctx, name, GUEST, input), `${name} guest`).rejects.toThrow();
      await expect(run(ctx, name, member, input), `${name} member`).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(run(ctx, name, token, input), `${name} token`).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(run(ctx, name, moderator, input), `${name} moderator`).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    for (const [name, input] of calls(entry.id)) await run(ctx, name, admin, input);
  });

  test("an administrator-level member without admin.settings is refused", async () => {
    const { ctx, create } = setup();
    const group = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Forum team', 10) RETURNING id",
      )
      .get()!.id;
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ?1, 0, 1 FROM permission_definitions WHERE key = 'admin.nodes'",
      )
      .run(group);
    const actor = userActor(insertUser(ctx, { groupId: group }));
    const entry = await create({});
    await expect(run(ctx, "navigation.list", actor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      run(ctx, "navigation.delete", actor, { entryId: entry.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("every write adds a moderator-log entry", async () => {
    const { ctx, admin, create } = setup();
    const entry = await create({});
    await run(ctx, "navigation.update", admin, { entryId: entry.id, title: "Z" });
    await run(ctx, "navigation.delete", admin, { entryId: entry.id });
    const actions = ctx.sqlite
      .prepare<{ action: string }, []>(
        "SELECT action FROM moderator_log WHERE target_type = 'navigation_entry' ORDER BY id",
      )
      .all()
      .map((row) => row.action);
    expect(actions).toEqual(["navigation.create", "navigation.update", "navigation.delete"]);
  });
});

describe("navigation.create and update rules", () => {
  const refused = ["a b", "ab", "ab", "a​b"];
  const accepted = ["/forums", "/pages/rules?x=1#top", "https://example.test/a?b=c"];

  test("create refuses a target with a control or invisible character and accepts ordinary ones", async () => {
    const { ctx, admin, create } = setup();
    for (const suffix of refused)
      for (const target of [`/forums${suffix}`, `https://example.test/${suffix}`])
        await expect(create({ target }), JSON.stringify(target)).rejects.toThrow();
    for (const target of accepted) expect((await create({ target })).target).toBe(target);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM navigation_entries WHERE title = 'Link'",
        )
        .get()!.n,
    ).toBe(accepted.length);
    expect(admin).toBeDefined();
  });

  test("update refuses a target with a control or invisible character and accepts ordinary ones", async () => {
    const { ctx, admin, create } = setup();
    const entry = await create({ target: "/start" });
    const update = (target: string) =>
      run(ctx, "navigation.update", admin, { entryId: entry.id, target });
    for (const suffix of refused)
      await expect(update(`/forums${suffix}`), JSON.stringify(suffix)).rejects.toThrow();
    for (const target of accepted) expect((await update(target)).target).toBe(target);
  });

  test("settings.update refuses a social link with a control or invisible character", async () => {
    const { ctx, admin } = setup();
    const update = (url: string) =>
      run(ctx, "settings.update", admin, {
        socialLinks: { discord: null, telegram: null, x: url },
      });
    for (const suffix of refused)
      await expect(
        update(`https://example.test/a${suffix}`),
        JSON.stringify(suffix),
      ).rejects.toThrow();
    await expect(update("https://example.test/a?b=c")).resolves.toBeDefined();
  });

  test("create returns the entry it wrote without reading it back after the commit", async () => {
    const { ctx, create } = setup();
    const prepare = ctx.sqlite.prepare.bind(ctx.sqlite);
    const seen: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: the wrapper only records the SQL text
    (ctx.sqlite as any).prepare = (sql: string) => {
      seen.push(sql);
      return prepare(sql);
    };
    try {
      const created = await create({ title: "Fresh" });
      expect(created).toMatchObject({ title: "Fresh", target: "/x", builtin: null });
      expect(seen).not.toContain(navigationSql.one);
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: restoring the method replaced above
      (ctx.sqlite as any).prepare = prepare;
    }
  });

  test("an unknown entry is not found", async () => {
    const { ctx, admin } = setup();
    await expect(
      run(ctx, "navigation.update", admin, { entryId: 99999, title: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(run(ctx, "navigation.delete", admin, { entryId: 99999 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("at most 200 entries", async () => {
    const { ctx, create } = setup();
    const { n } = ctx.sqlite
      .prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM navigation_entries")
      .get()!;
    for (let i = n; i < NAVIGATION_LIMIT; i++) await create({ title: `E${i}` });
    await expect(create({ title: "One more" })).rejects.toBeInstanceOf(ConflictError);
  });

  test("a parent must exist, be top-level and be in the same location", async () => {
    const { ctx, admin, create, entryId } = setup();
    await expect(create({ parentId: 99999 })).rejects.toBeInstanceOf(ValidationError);
    const parent = await create({ location: "footer", title: "Parent", target: null });
    await expect(create({ location: "header", parentId: parent.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const child = await create({ location: "footer", parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
    await expect(create({ location: "footer", parentId: child.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      run(ctx, "navigation.update", admin, { entryId: child.id, location: "header" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      run(ctx, "navigation.update", admin, { entryId: child.id, parentId: entryId("header.home") }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("an entry cannot be its own parent, and two levels only", async () => {
    const { ctx, admin, create } = setup();
    const a = await create({ title: "A" });
    const b = await create({ title: "B" });
    await expect(
      run(ctx, "navigation.update", admin, { entryId: a.id, parentId: a.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await run(ctx, "navigation.update", admin, { entryId: b.id, parentId: a.id });
    // a has a child now: it cannot get a parent, and b (a child) cannot have children.
    const c = await create({ title: "C" });
    await expect(
      run(ctx, "navigation.update", admin, { entryId: a.id, parentId: c.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      run(ctx, "navigation.update", admin, { entryId: c.id, parentId: b.id }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("an entry with children cannot move to another location", async () => {
    const { ctx, admin, create } = setup();
    const parent = await create({ location: "footer", title: "P" });
    await create({ location: "footer", parentId: parent.id });
    await expect(
      run(ctx, "navigation.update", admin, { entryId: parent.id, location: "header" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const lone = await create({ title: "Lone" });
    const moved = await run(ctx, "navigation.update", admin, {
      entryId: lone.id,
      location: "mobile",
    });
    expect(moved.location).toBe("mobile");
  });

  test("audience permission needs a registered global permission, other audiences none", async () => {
    const { ctx, admin, create } = setup();
    await expect(create({ audience: "permission" })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create({ audience: "permission", permission: "no.such.thing" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create({ audience: "permission", permission: "notification.view" }),
    ).resolves.toMatchObject({
      permission: "notification.view",
    });
    // node.view is node-scoped
    // so is forum.reply; admin.members needs a target member, which a menu cannot supply
    for (const permission of ["forum.reply", "admin.members", "attachment.storageQuota"])
      await expect(create({ audience: "permission", permission })).rejects.toBeInstanceOf(
        ValidationError,
      );
    await expect(
      create({ audience: "permission", permission: "node.view" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      create({ audience: "members", permission: "notification.view" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const entry = await create({ audience: "permission", permission: "admin.settings" });
    await expect(
      run(ctx, "navigation.update", admin, {
        entryId: entry.id,
        audience: "everyone",
        permission: "admin.settings",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const cleared = await run(ctx, "navigation.update", admin, {
      entryId: entry.id,
      audience: "guests",
    });
    expect(cleared).toMatchObject({ audience: "guests", permission: null });
    await expect(
      run(ctx, "navigation.update", admin, { entryId: entry.id, audience: "permission" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const retitled = await run(ctx, "navigation.update", admin, {
      entryId: entry.id,
      audience: "permission",
      permission: "notification.view",
    });
    expect(retitled.permission).toBe("notification.view");
  });

  test("a failed write changes nothing and does not leave the cache stale", async () => {
    const { ctx, create } = setup();
    await run(ctx, "navigation.get", GUEST);
    await expect(create({ title: "Bad", parentId: 99999 })).rejects.toBeInstanceOf(ValidationError);
    const view = await run(ctx, "navigation.get", GUEST);
    expect(view.header.map((link: { title: string }) => link.title)).not.toContain("Bad");
  });

  test("a built-in entry accepts title, position, enabled and audience; not location, parent or target", async () => {
    const { ctx, admin, entryId } = setup();
    const id = entryId("footer.legal.terms");
    const parentId = entryId("footer.legal");
    const changed = await run(ctx, "navigation.update", admin, {
      entryId: id,
      title: "Conditions",
      position: 9,
      isEnabled: false,
      audience: "members",
      // the current values are fine
      location: "footer",
      parentId,
      target: "/terms",
    });
    expect(changed).toMatchObject({
      title: "Conditions",
      position: 9,
      isEnabled: false,
      audience: "members",
      builtin: "footer.legal.terms",
    });
    for (const change of [
      { location: "header" },
      { parentId: null },
      { target: "/elsewhere" },
      { target: null },
    ])
      await expect(
        run(ctx, "navigation.update", admin, { entryId: id, ...change }),
      ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      run(ctx, "navigation.update", admin, {
        entryId: entryId("header.home"),
        target: "https://example.test",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("deleting a built-in entry is a conflict; deleting a parent deletes its children", async () => {
    const { ctx, admin, create, entryId } = setup();
    await expect(
      run(ctx, "navigation.delete", admin, { entryId: entryId("footer.legal") }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      run(ctx, "navigation.delete", admin, { entryId: entryId("header.home") }),
    ).rejects.toBeInstanceOf(ConflictError);
    const parent = await create({ location: "footer", title: "P" });
    const child = await create({ location: "footer", parentId: parent.id });
    await run(ctx, "navigation.delete", admin, { entryId: parent.id });
    const ids = (await run(ctx, "navigation.list", admin)).items.map(
      (entry: { id: number }) => entry.id,
    );
    expect(ids).not.toContain(parent.id);
    expect(ids).not.toContain(child.id);
  });

  test("the list holds every entry, enabled or not, with the administrative fields", async () => {
    const { ctx, admin, create, entryId } = setup();
    await run(ctx, "navigation.update", admin, {
      entryId: entryId("header.home"),
      isEnabled: false,
    });
    const off = await create({ title: "Off", isEnabled: false });
    const { items } = await run(ctx, "navigation.list", admin);
    expect(items.find((entry: { id: number }) => entry.id === off.id)).toMatchObject({
      isEnabled: false,
      builtin: null,
      audience: "everyone",
    });
    expect(
      items.find((entry: { builtin: string }) => entry.builtin === "header.home").isEnabled,
    ).toBe(false);
    // location, then parents before children, then position and id
    const footer = items.filter((entry: { location: string }) => entry.location === "footer");
    const firstChild = footer.findIndex(
      (entry: { parentId: number | null }) => entry.parentId !== null,
    );
    expect(
      footer
        .slice(0, firstChild)
        .every((entry: { parentId: number | null }) => entry.parentId === null),
    ).toBe(true);
    const locations = items.map((entry: { location: string }) => entry.location);
    expect(locations).toEqual(
      [...locations].sort(
        (a, b) =>
          ["header", "mobile", "account", "footer"].indexOf(a) -
          ["header", "mobile", "account", "footer"].indexOf(b),
      ),
    );
  });
});

describe("navigation icons", () => {
  test("an icon and its position round-trip through create, update, list and get", async () => {
    const { ctx, create, admin, member } = setup();
    const made = await create({ icon: "star", iconPosition: "after" });
    expect(made.icon).toBe("star");
    expect(made.iconPosition).toBe("after");
    const plain = await create({ title: "Plain" });
    expect(plain.icon).toBeNull();
    expect(plain.iconPosition).toBe("before");
    const changed = await run(ctx, "navigation.update", admin, {
      entryId: made.id,
      icon: "house",
      iconPosition: "before",
    });
    expect([changed.icon, changed.iconPosition]).toEqual(["house", "before"]);
    const untouched = await run(ctx, "navigation.update", admin, {
      entryId: made.id,
      title: "Renamed",
    });
    expect([untouched.icon, untouched.iconPosition]).toEqual(["house", "before"]);
    const listed = (await run(ctx, "navigation.list", admin)).items.find(
      (entry: { id: number }) => entry.id === made.id,
    );
    expect([listed.icon, listed.iconPosition]).toEqual(["house", "before"]);
    const view = await run(ctx, "navigation.get", member);
    const link = view.header.find((entry: { id: number }) => entry.id === made.id);
    expect([link.icon, link.iconPosition]).toEqual(["house", "before"]);
  });

  test("null clears the icon", async () => {
    const { ctx, create, admin } = setup();
    const made = await create({ icon: "star" });
    const cleared = await run(ctx, "navigation.update", admin, { entryId: made.id, icon: null });
    expect(cleared.icon).toBeNull();
  });

  test("a child's icon is part of its parent's link", async () => {
    const { ctx, create, member } = setup();
    const parent = await create({ title: "Parent", target: null });
    await create({ title: "Child", parentId: parent.id, icon: "book-open", iconPosition: "after" });
    const view = await run(ctx, "navigation.get", member);
    const link = view.header.find((entry: { id: number }) => entry.id === parent.id);
    expect([link.children[0].icon, link.children[0].iconPosition]).toEqual(["book-open", "after"]);
  });

  test("a built-in entry may change its icon and position", async () => {
    const { ctx, admin, entryId } = setup();
    const id = entryId("header.home");
    const changed = await run(ctx, "navigation.update", admin, {
      entryId: id,
      icon: "messages-square",
      iconPosition: "after",
    });
    expect([changed.icon, changed.iconPosition]).toEqual(["messages-square", "after"]);
  });

  test("a malformed key is a validation error", async () => {
    const { ctx, create, admin } = setup();
    const made = await create({});
    for (const icon of ["Star", "two words", "-star", "star-", "a--b", "", "x".repeat(65)]) {
      await expect(create({ icon })).rejects.toBeInstanceOf(ValidationError);
      await expect(
        run(ctx, "navigation.update", admin, { entryId: made.id, icon }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(create({ iconPosition: "middle" })).rejects.toBeInstanceOf(ValidationError);
  });

  test("permissions are unchanged", async () => {
    const { ctx, create, member, moderator } = setup();
    await expect(create({ icon: "star" }, member)).rejects.toBeInstanceOf(ForbiddenError);
    const made = await create({});
    await expect(
      run(ctx, "navigation.update", moderator, { entryId: made.id, icon: "star" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
