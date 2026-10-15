import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { PERMISSIONS } from "../../permissions";
import { customMember } from "./group-fixture";

const run = (ctx: Ctx, name: string, actor: Parameters<typeof execute>[2], input: object = {}) =>
  // biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
  execute(ctx, getOperation(name), actor, input) as Promise<any>;

function world() {
  const ctx = createTestContext();
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const member = userActor(insertUser(ctx));
  const colorId = ctx.sqlite
    .prepare<{ id: number }, []>(
      "SELECT id FROM palette_colors WHERE kind = 'prefix' AND is_active = 1 ORDER BY position LIMIT 1",
    )
    .get()!.id;
  return { ctx, moderator, member, colorId };
}

describe("registry shapes", () => {
  test("the three admin areas are administrator-only by default", () => {
    for (const id of ["admin.prefixes", "admin.navigation", "admin.pages"] as const)
      expect(PERMISSIONS[id].defaults).toEqual({ admin: "allow" });
  });
});

describe("admin.prefixes", () => {
  const create = (w: ReturnType<typeof world>, actor: Parameters<typeof execute>[2]) =>
    run(w.ctx, "threadPrefixes.create", actor, { label: "News", colorId: w.colorId });

  test("guests, members and moderators are refused; the group holding it is served", async () => {
    const w = world();
    await expect(create(w, GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(create(w, w.member)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(create(w, w.moderator)).rejects.toBeInstanceOf(ForbiddenError);
    const holder = customMember(w.ctx, ["admin.prefixes"]);
    const made = await create(w, holder.actor);
    await run(w.ctx, "threadPrefixes.update", holder.actor, { prefixId: made.id, label: "More" });
    const listed = await run(w.ctx, "threadPrefixes.list", holder.actor);
    expect(listed.items.map((item: { label: string }) => item.label)).toContain("More");
    await run(w.ctx, "threadPrefixes.update", holder.actor, { prefixId: made.id, isActive: false });
    // An inactive prefix is listed only to those who manage prefixes.
    expect((await run(w.ctx, "threadPrefixes.list", holder.actor)).items).toHaveLength(1);
    expect((await run(w.ctx, "threadPrefixes.list", w.member)).items).toHaveLength(0);
    await run(w.ctx, "threadPrefixes.delete", holder.actor, { prefixId: made.id });
  });

  test("admin.nodes no longer manages prefixes, and prefixes do not open the forum tabs", async () => {
    const w = world();
    const nodes = customMember(w.ctx, ["admin.nodes", "admin.settings"]);
    await expect(create(w, nodes.actor)).rejects.toBeInstanceOf(ForbiddenError);
    const prefixes = customMember(w.ctx, ["admin.prefixes"]);
    await expect(
      run(w.ctx, "forumTabs.create", prefixes.actor, { title: "Tab", position: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await run(w.ctx, "forumTabs.create", nodes.actor, { title: "Tab", position: 1 });
  });
});

describe("admin.navigation", () => {
  const input = { location: "header", title: "Link", target: "/x" };

  test("guests, members, moderators and the other admin areas are refused", async () => {
    const w = world();
    await expect(run(w.ctx, "navigation.create", GUEST, input)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    for (const actor of [
      w.member,
      w.moderator,
      customMember(w.ctx, ["admin.settings", "admin.pages", "admin.nodes"]).actor,
    ]) {
      await expect(run(w.ctx, "navigation.list", actor)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(run(w.ctx, "navigation.create", actor, input)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });

  test("the group holding it lists, creates, updates and deletes entries", async () => {
    const w = world();
    const holder = customMember(w.ctx, ["admin.navigation"]);
    const made = await run(w.ctx, "navigation.create", holder.actor, input);
    await run(w.ctx, "navigation.update", holder.actor, { entryId: made.id, title: "Renamed" });
    expect((await run(w.ctx, "navigation.list", holder.actor)).items.length).toBeGreaterThan(0);
    await run(w.ctx, "navigation.delete", holder.actor, { entryId: made.id });
  });
});

describe("admin.pages", () => {
  const page = { slug: "about", title: "About", body: "Hello", isPublished: false };

  test("guests, members, moderators and the other admin areas are refused", async () => {
    const w = world();
    await expect(run(w.ctx, "pages.save", GUEST, page)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    for (const actor of [
      w.member,
      w.moderator,
      customMember(w.ctx, ["admin.settings", "admin.navigation"]).actor,
    ]) {
      await expect(run(w.ctx, "pages.save", actor, page)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(run(w.ctx, "pages.list", actor)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  test("the group holding it manages pages and reads unpublished ones", async () => {
    const w = world();
    const holder = customMember(w.ctx, ["admin.pages"]);
    await run(w.ctx, "pages.save", holder.actor, page);
    expect((await run(w.ctx, "pages.list", holder.actor)).items).toHaveLength(1);
    const source = await run(w.ctx, "pages.getSource", holder.actor, { slug: "about" });
    expect(source.bodySource).toBe("Hello");
    expect((await run(w.ctx, "pages.get", holder.actor, { slug: "about" })).title).toBe("About");
    // Anyone else gets a draft as missing, even with the settings permission.
    const settings = customMember(w.ctx, ["admin.settings"]);
    await expect(run(w.ctx, "pages.get", settings.actor, { slug: "about" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await run(w.ctx, "pages.delete", holder.actor, { slug: "about" });
  });
});
