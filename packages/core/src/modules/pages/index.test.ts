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
import { PAGE_BODY_LENGTH } from "../../contracts/pages";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { PAGE_LIMIT, pageSql } from "./index";

const run = (ctx: Ctx, name: string, actor: Parameters<typeof execute>[2], input: object = {}) =>
  // biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
  execute(ctx, getOperation(name), actor, input) as Promise<any>;

function setup() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const memberUser = insertUser(ctx);
  const member = userActor(memberUser);
  const token = tokenActor(memberUser);
  const save = (slug: string, extra: object = {}, actor = admin) =>
    run(ctx, "pages.save", actor, {
      slug,
      title: `Title ${slug}`,
      body: "Hello **world**",
      ...extra,
    });
  return { ctx, admin, moderator, member, token, save };
}

describe("pages", () => {
  test("save creates then replaces by slug, rendering the Markdown", async () => {
    const { ctx, admin, save } = setup();
    const created = await save("terms");
    expect(created).toMatchObject({
      slug: "terms",
      title: "Title terms",
      bodySource: "Hello **world**",
      isPublished: true,
    });
    expect(created.bodyHtml).toContain("<strong>world</strong>");
    const replaced = await save("terms", { title: "New", body: "# Heading", isPublished: false });
    expect(replaced).toMatchObject({ title: "New", bodySource: "# Heading", isPublished: false });
    expect(replaced.bodyHtml).toContain("<h1>Heading</h1>");
    expect((await run(ctx, "pages.list", admin)).items).toHaveLength(1);
  });

  test("get returns a published page to everyone, with no source", async () => {
    const { ctx, member, save } = setup();
    await save("privacy");
    for (const actor of [GUEST, member]) {
      const page = await run(ctx, "pages.get", actor, { slug: "privacy" });
      expect(Object.keys(page).sort()).toEqual([
        "bodyHtml",
        "isPublished",
        "slug",
        "title",
        "updatedAt",
        "version",
      ]);
    }
  });

  test("an unpublished page is not found for others; an administrator sees it", async () => {
    const { ctx, admin, moderator, member, token, save } = setup();
    await save("draft", { isPublished: false });
    for (const actor of [GUEST, member, token, moderator])
      await expect(run(ctx, "pages.get", actor, { slug: "draft" })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    expect((await run(ctx, "pages.get", admin, { slug: "draft" })).isPublished).toBe(false);
    await expect(run(ctx, "pages.get", GUEST, { slug: "missing" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("list, save and delete need admin.settings", async () => {
    const { ctx, admin, moderator, member, token, save } = setup();
    await save("a");
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
    const teamMember = userActor(insertUser(ctx, { groupId: group }));
    const calls: [string, object][] = [
      ["pages.list", {}],
      ["pages.getSource", { slug: "a" }],
      ["pages.save", { slug: "b", title: "B", body: "text" }],
      ["pages.delete", { slug: "a" }],
    ];
    for (const [name, input] of calls) {
      await expect(run(ctx, name, GUEST, input), `${name} guest`).rejects.toThrow();
      for (const actor of [member, token, moderator, teamMember])
        await expect(run(ctx, name, actor, input), name).rejects.toBeInstanceOf(ForbiddenError);
    }
    for (const [name, input] of calls) await run(ctx, name, admin, input);
  });

  test("list returns every page without its text, ordered by slug", async () => {
    const { ctx, admin, save } = setup();
    await save("zeta");
    await save("alpha", { isPublished: false, body: "*src*" });
    const { items } = await run(ctx, "pages.list", admin);
    expect(items.map((page: { slug: string }) => page.slug)).toEqual(["alpha", "zeta"]);
    expect(Object.keys(items[0]).sort()).toEqual([
      "isPublished",
      "slug",
      "title",
      "updatedAt",
      "version",
    ]);
    expect(items[0]).toMatchObject({ title: "Title alpha", isPublished: false });
  });

  test("getSource returns one page with its source, published or not", async () => {
    const { ctx, admin, save } = setup();
    await save("draft", { isPublished: false, body: "*src*" });
    await save("live");
    expect(await run(ctx, "pages.getSource", admin, { slug: "draft" })).toMatchObject({
      slug: "draft",
      title: "Title draft",
      bodySource: "*src*",
      bodyHtml: "<p><em>src</em></p>",
      isPublished: false,
    });
    expect((await run(ctx, "pages.getSource", admin, { slug: "live" })).bodySource).toBe(
      "Hello **world**",
    );
  });

  test("getSource: an unknown slug is not found for an administrator, and a member is refused before any lookup", async () => {
    const { ctx, admin, member, save } = setup();
    await save("real");
    await expect(run(ctx, "pages.getSource", admin, { slug: "nope" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    for (const slug of ["real", "nope"]) {
      await expect(run(ctx, "pages.getSource", member, { slug })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(run(ctx, "pages.getSource", GUEST, { slug })).rejects.not.toBeInstanceOf(
        NotFoundError,
      );
    }
  });

  test("delete removes the page; an unknown slug is not found", async () => {
    const { ctx, admin, save } = setup();
    await save("gone");
    await run(ctx, "pages.delete", admin, { slug: "gone" });
    await expect(run(ctx, "pages.get", admin, { slug: "gone" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(run(ctx, "pages.delete", admin, { slug: "gone" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("a body of the limit is accepted and one more character is refused", async () => {
    const { ctx, admin, save } = setup();
    const body = `${"word ".repeat(PAGE_BODY_LENGTH / 5).slice(0, PAGE_BODY_LENGTH - 1)}x`;
    expect(body).toHaveLength(PAGE_BODY_LENGTH);
    const saved = await save("long", { body });
    expect(saved.bodySource).toHaveLength(PAGE_BODY_LENGTH);
    await expect(save("long", { body: `${body}x` })).rejects.toThrow();
    expect((await run(ctx, "pages.get", admin, { slug: "long" })).bodyHtml.length).toBeGreaterThan(
      PAGE_BODY_LENGTH - 1_000,
    );
  });

  test("the worst case for the renderer, a body of the limit made of emphasis runs, renders in bounded time", async () => {
    const { save } = setup();
    const body = "_a ".repeat(Math.ceil(PAGE_BODY_LENGTH / 3)).slice(0, PAGE_BODY_LENGTH);
    expect(body).toHaveLength(PAGE_BODY_LENGTH);
    const started = performance.now();
    await save("worst", { body });
    const elapsed = performance.now() - started;
    console.log(`pages.save of ${PAGE_BODY_LENGTH} characters of "_a ": ${Math.round(elapsed)} ms`);
    expect(elapsed).toBeLessThan(10_000);
  });

  test("raw HTML and scripts are sanitised like a post, and mentions are left alone", async () => {
    const { ctx, save } = setup();
    insertUser(ctx, { username: "Alice" });
    const page = await save("html", {
      body: "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\nHi @Alice",
    });
    expect(page.bodyHtml).not.toContain("<script");
    expect(page.bodyHtml).not.toContain("<img");
    expect(page.bodyHtml).not.toContain("javascript:");
    expect(page.bodyHtml).not.toContain("data-user-id");
    expect(page.bodySource).toContain("<script>");
    expect(
      ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM content_mentions").get()!.n,
    ).toBe(0);
  });

  test("a failed render stores nothing", async () => {
    const { ctx, save } = setup();
    await expect(save("deep", { body: `${"> ".repeat(12)}too deep` })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(
      ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM static_pages").get()!.n,
    ).toBe(0);
  });

  test("at most 100 pages; replacing one at the limit still works", async () => {
    const { save } = setup();
    for (let i = 0; i < PAGE_LIMIT; i++) await save(`page-${i}`);
    await expect(save("one-more")).rejects.toBeInstanceOf(ConflictError);
    await expect(save("page-3", { title: "Again" })).resolves.toMatchObject({ title: "Again" });
  });

  test("slugs are validated", async () => {
    const { ctx, admin } = setup();
    for (const slug of ["Terms", "-x", "x-", "a b", "a/b", "x".repeat(61)])
      await expect(
        run(ctx, "pages.save", admin, { slug, title: "T", body: "b" }),
        slug,
      ).rejects.toThrow();
  });

  test("each write adds a moderator-log entry", async () => {
    const { ctx, admin, save } = setup();
    await save("logged");
    await run(ctx, "pages.delete", admin, { slug: "logged" });
    const actions = ctx.sqlite
      .prepare<{ action: string }, []>(
        "SELECT action FROM moderator_log WHERE target_type = 'static_page' ORDER BY id",
      )
      .all()
      .map((row) => row.action);
    expect(actions).toEqual(["page.save", "page.delete"]);
  });

  test("the listing reads no page text", () => {
    const { ctx } = setup();
    expect(ctx.sqlite.prepare(pageSql.all).columnNames).toEqual([
      "slug",
      "title",
      "is_published",
      "version",
      "updated_at",
    ]);
  });

  test("the lookup uses an index", () => {
    const { ctx } = setup();
    expectNoTableScan(ctx, pageSql.bySlug, ["terms"]);
  });
});
