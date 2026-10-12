import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";
import { syncPermissionRegistry } from "../permissions/sync";
import { insertUser } from "../testing";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

function applyMigrations(ctx: Ctx, from: number, through = Number.POSITIVE_INFINITY) {
  ctx.sqlite.transaction(() => {
    for (const entry of journal.entries.filter(
      (entry) => entry.idx >= from && entry.idx <= through,
    )) {
      const sql = readFileSync(new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) ctx.sqlite.run(statement);
    }
  })();
}

function before() {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, 23);
  syncPermissionRegistry(ctx);
  const category = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO shop_categories (name, description, position, is_active, created_at, updated_at) VALUES ('c', '', 0, 1, 0, 0) RETURNING id",
    )
    .get()!.id;
  const add = (name: string, effect: unknown, active = 1) =>
    ctx.sqlite
      .prepare<{ id: number }, [number, string, number, string]>(
        "INSERT INTO shop_items (category_id, name, price, is_active, effect, created_at, updated_at) VALUES (?1, ?2, 10, ?3, ?4, 0, 0) RETURNING id",
      )
      .get(category, name, active, JSON.stringify(effect))!.id;
  const effectOf = (id: number) =>
    JSON.parse(
      ctx.sqlite
        .prepare<{ effect: string }, [number]>("SELECT effect FROM shop_items WHERE id = ?1")
        .get(id)!.effect,
    );
  const activeOf = (id: number) =>
    ctx.sqlite
      .prepare<{ is_active: number }, [number]>("SELECT is_active FROM shop_items WHERE id = ?1")
      .get(id)!.is_active;
  return { ctx, add, effectOf, activeOf };
}

describe("migration 0024 converts shop effects to catalog ids", () => {
  test("name colours reuse an entry of the same colour or add one, shared by items of one colour", () => {
    const { ctx, add, effectOf, activeOf } = before();
    const existing = ctx.sqlite
      .prepare<{ id: number; color: string }, []>(
        "SELECT id, color FROM palette_colors WHERE kind = 'name' ORDER BY position LIMIT 1",
      )
      .get()!;
    const maxPosition = () =>
      ctx.sqlite
        .prepare<{ p: number }, []>(
          "SELECT MAX(position) AS p FROM palette_colors WHERE kind = 'name'",
        )
        .get()!.p;
    const lastPosition = maxPosition();
    const reuse = add("reuse", { type: "nameColor", color: existing.color.toUpperCase() });
    const first = add("first", { type: "nameColor", color: "#123abc" });
    const second = add("second", { type: "nameColor", color: "#123ABC" });
    const other = add("other", { type: "nameColor", color: "#abcdef" });
    const user = insertUser(ctx);
    const row = ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO shop_inventory (user_id, item_id, state, quantity, acquired_at, updated_at) VALUES (?1, ?2, 'active', 1, 0, 0) RETURNING id",
      )
      .get(user.id, first)!.id;

    applyMigrations(ctx, 24);

    expect(effectOf(reuse)).toEqual({ type: "nameColor", colorId: existing.id });
    const created = effectOf(first).colorId as number;
    expect(created).not.toBe(existing.id);
    expect(effectOf(second)).toEqual({ type: "nameColor", colorId: created });
    expect(effectOf(other).colorId).not.toBe(created);
    const entry = ctx.sqlite
      .prepare<
        { kind: string; name: string; color: string; is_active: number; position: number },
        [number]
      >("SELECT kind, name, color, is_active, position FROM palette_colors WHERE id = ?1")
      .get(created)!;
    expect(entry).toMatchObject({ kind: "name", name: "#123abc", color: "#123abc", is_active: 1 });
    expect(entry.position).toBeGreaterThan(lastPosition);
    expect(maxPosition()).toBe(lastPosition + 2);
    expect([reuse, first, second, other].map(activeOf)).toEqual([1, 1, 1, 1]);
    expect(
      ctx.sqlite
        .prepare<{ item_id: number }, [number]>("SELECT item_id FROM shop_inventory WHERE id = ?1")
        .get(row)!.item_id,
    ).toBe(first);
  });

  test("a colour whose only entry is inactive deactivates the item", () => {
    const { ctx, add, effectOf, activeOf } = before();
    ctx.sqlite
      .prepare(
        "INSERT INTO palette_colors (kind, name, color, position, is_active, created_at, updated_at) VALUES ('name', 'Old', '#010203', 99, 0, 0, 0)",
      )
      .run();
    const id = add("old", { type: "nameColor", color: "#010203" });
    applyMigrations(ctx, 24);
    expect(activeOf(id)).toBe(0);
    expect(effectOf(id).colorId).toBeGreaterThan(0);
  });

  test("frame and cover keys become inactive entries without a picture and the items are deactivated", () => {
    const { ctx, add, effectOf, activeOf } = before();
    const a = add("a", { type: "frame", frame: "gold" });
    const b = add("b", { type: "frame", frame: "gold" });
    const c = add("c", { type: "frame", frame: "silver" });
    const d = add("d", { type: "threadCover", cover: "sunset" });
    const e = add("e", { type: "threadCover", cover: "gold" });

    applyMigrations(ctx, 24);

    const entry = (id: number) =>
      ctx.sqlite
        .prepare<
          { kind: string; name: string; file_id: number | null; is_active: number },
          [number]
        >("SELECT kind, name, file_id, is_active FROM catalog_images WHERE id = ?1")
        .get(id)!;
    expect(effectOf(b)).toEqual(effectOf(a));
    expect(effectOf(c).frameId).not.toBe(effectOf(a).frameId);
    expect(entry(effectOf(a).frameId)).toEqual({
      kind: "frame",
      name: "gold",
      file_id: null,
      is_active: 0,
    });
    expect(entry(effectOf(c).frameId).name).toBe("silver");
    expect(entry(effectOf(d).coverId)).toEqual({
      kind: "thread_cover",
      name: "sunset",
      file_id: null,
      is_active: 0,
    });
    expect(entry(effectOf(e).coverId).kind).toBe("thread_cover");
    expect([a, b, c, d, e].map(activeOf)).toEqual([0, 0, 0, 0, 0]);
    expect(
      ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM catalog_images").get()!.n,
    ).toBe(4);
  });

  test("effects already in the new shape and other types are untouched, and no items is a no-op", () => {
    const empty = before();
    applyMigrations(empty.ctx, 24);
    expect(
      empty.ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM catalog_images").get()!
        .n,
    ).toBe(0);

    const { ctx, add, effectOf, activeOf } = before();
    const colors = ctx.sqlite
      .prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM palette_colors")
      .get()!.n;
    const current = add("new", { type: "nameColor", colorId: 7 });
    const frame = add("frame", { type: "frame", frameId: 3 });
    const bump = add("bump", { type: "bump" });
    const permission = add("permission", { type: "permission", permission: "forum.reply" }, 0);
    applyMigrations(ctx, 24);
    expect(effectOf(current)).toEqual({ type: "nameColor", colorId: 7 });
    expect(effectOf(frame)).toEqual({ type: "frame", frameId: 3 });
    expect(effectOf(bump)).toEqual({ type: "bump" });
    expect(effectOf(permission)).toEqual({ type: "permission", permission: "forum.reply" });
    expect([current, frame, bump, permission].map(activeOf)).toEqual([1, 1, 1, 0]);
    expect(
      ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM palette_colors").get()!.n,
    ).toBe(colors);
  });
});
