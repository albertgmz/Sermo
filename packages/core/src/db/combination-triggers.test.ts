import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";
import { deletePromotionChunk, evaluateMember, sweepChunk } from "../modules/promotions";
import { execute } from "../operation";
import { getOperation } from "../operations";
import { can, permissionValue } from "../permissions";
import { syncPermissionRegistry } from "../permissions/sync";
import { createTestContext, insertUser, userActor } from "../testing";

/** The combination a member must be on, computed from the tables the triggers watch. */
function expected(ctx: Ctx, userId: number) {
  const exists = (table: string, where: string) =>
    !!ctx.sqlite.prepare(`SELECT 1 FROM ${table} WHERE ${where} LIMIT 1`).get(userId);
  const isPrivate =
    exists("permission_entries", "group_id = 0 AND user_id = ?1") ||
    exists("shop_permission_grants", "user_id = ?1");
  const groups = ctx.sqlite
    .prepare<{ g: number }, [number]>(
      "SELECT group_id AS g FROM users WHERE id = ?1 UNION SELECT group_id FROM user_groups WHERE user_id = ?1 UNION SELECT group_id FROM user_group_grants WHERE user_id = ?1 UNION SELECT group_id FROM shop_group_grants WHERE user_id = ?1 ORDER BY g",
    )
    .all(userId)
    .map((row) => row.g);
  return { user_id: isPrivate ? userId : 0, group_ids: groups.join(",") };
}
function actual(ctx: Ctx, userId: number) {
  return ctx.sqlite
    .prepare<{ user_id: number; group_ids: string }, [number]>(
      "SELECT c.user_id, c.group_ids FROM users u LEFT JOIN permission_combinations c ON c.id = u.permission_combination_id WHERE u.id = ?1",
    )
    .get(userId)!;
}
function setup(ctx: Ctx = createTestContext()) {
  const first = insertUser(ctx);
  const second = insertUser(ctx);
  const group = (title: string) =>
    ctx.sqlite
      .prepare<{ id: number }, [string]>(
        "INSERT INTO groups (title, rank) VALUES (?1, 5) RETURNING id",
      )
      .get(title)!.id;
  const definition = (key: string) =>
    ctx.sqlite
      .prepare<{ id: number }, [string]>("SELECT id FROM permission_definitions WHERE key = ?1")
      .get(key)!.id;
  const consistent = () => {
    for (const user of [first, second])
      expect(actual(ctx, user.id)).toEqual(expected(ctx, user.id));
  };
  return { ctx, first, second, group, definition, consistent };
}

const upgradeContexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of upgradeContexts.splice(0)) closeContext(ctx);
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

function beforeCombinationUpdateTriggers() {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  upgradeContexts.push(ctx);
  applyMigrations(ctx, 0, 16);
  // This database stops at an early migration; the principal load reads a later column.
  ctx.sqlite.run("ALTER TABLE users ADD COLUMN is_super_admin integer DEFAULT false NOT NULL");
  ctx.sqlite.run("ALTER TABLE users ADD COLUMN signup_review text");
  // The promotion evaluation reads the rule column that migration 0036 adds.
  ctx.sqlite.run(
    `ALTER TABLE promotions ADD COLUMN rule text DEFAULT '{"match":"all","conditions":[]}' NOT NULL`,
  );
  syncPermissionRegistry(ctx);
  return setup(ctx);
}

describe("upgrades repair existing permission data", () => {
  test("repairs a secondary membership changed from Administrator to Member before 0017", () => {
    const { ctx, first, consistent } = beforeCombinationUpdateTriggers();
    ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 4, 0)")
      .run(first.id);
    ctx.sqlite.prepare("UPDATE user_groups SET group_id = 2 WHERE user_id = ?1").run(first.id);
    expect(actual(ctx, first.id).group_ids).toBe("2,4");
    expect(expected(ctx, first.id).group_ids).toBe("2");
    expect(can(ctx, userActor(first), "admin.permissions")).toBe(true);

    applyMigrations(ctx, 17, 18);

    consistent();
    expect(can(ctx, userActor(first), "admin.permissions")).toBe(false);
  });

  test("keeps a legacy Unconfirmed administrator through verification without inheriting Member never", () => {
    const { ctx, first, second, definition } = beforeCombinationUpdateTriggers();
    ctx.sqlite.prepare("UPDATE users SET group_id = 5 WHERE id = ?1").run(first.id);
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 5, 0, 1), (?1, 0, 2, 0, -1)",
      )
      .run(definition("admin.permissions"));
    expect(can(ctx, userActor(first), "admin.permissions")).toBe(true);
    expect(can(ctx, userActor(second), "admin.permissions")).toBe(false);

    applyMigrations(ctx, 17, 18);
    ctx.sqlite
      .prepare("UPDATE users SET group_id = 2 WHERE id = ?1 AND group_id = 5")
      .run(first.id);

    expect(can(ctx, userActor(first), "admin.permissions")).toBe(true);
    expect(can(ctx, userActor(second), "admin.permissions")).toBe(false);
    expect(
      ctx.sqlite
        .prepare(
          "SELECT group_id FROM permission_entries WHERE permission_id = ?1 AND group_id IN (2, 5)",
        )
        .all(definition("admin.permissions")),
    ).toEqual([]);
    expect(
      ctx.sqlite
        .prepare(
          "SELECT user_id, value FROM permission_entries WHERE permission_id = ?1 AND group_id = 0 ORDER BY user_id",
        )
        .all(definition("admin.permissions")),
    ).toEqual([{ user_id: first.id, value: 1 }]);
    const entries = ctx.sqlite.prepare("SELECT * FROM permission_entries ORDER BY id").all();
    applyMigrations(ctx, 18, 18);
    expect(ctx.sqlite.prepare("SELECT * FROM permission_entries ORDER BY id").all()).toEqual(
      entries,
    );
  });

  for (const source of [
    "primary",
    "user_groups",
    "user_group_grants",
    "shop_group_grants",
  ] as const)
    for (const [groupValue, memberValue, result] of [
      [1, -1, -1],
      [-1, 1, -1],
      [1, 0, 1],
      [0, 1, 1],
    ] as const)
      test(`preserves ${source} Unconfirmed ${groupValue} with member ${memberValue}`, () => {
        const { ctx, first, definition } = beforeCombinationUpdateTriggers();
        if (source === "primary")
          ctx.sqlite.prepare("UPDATE users SET group_id = 5 WHERE id = ?1").run(first.id);
        else if (source === "user_groups")
          ctx.sqlite
            .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 5, 0)")
            .run(first.id);
        else if (source === "user_group_grants") {
          ctx.sqlite.run(
            "INSERT INTO promotions (id, title, group_ids, created_at, updated_at) VALUES (1, 'Legacy', '[5]', 0, 0)",
          );
          ctx.sqlite
            .prepare(
              "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, 1, 5, 0)",
            )
            .run(first.id);
        } else
          ctx.sqlite
            .prepare(
              "INSERT INTO shop_group_grants (user_id, inventory_id, group_id, created_at) VALUES (?1, 1, 5, 0)",
            )
            .run(first.id);
        ctx.sqlite
          .prepare(
            "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 5, 0, ?2), (?1, 0, 0, ?3, ?4)",
          )
          .run(definition("admin.permissions"), groupValue, first.id, memberValue);
        expect(can(ctx, userActor(first), "admin.permissions")).toBe(result === 1);

        applyMigrations(ctx, 17, 18);

        expect(
          ctx.sqlite
            .prepare(
              "SELECT value FROM permission_entries WHERE permission_id = ?1 AND group_id = 5",
            )
            .get(definition("admin.permissions")),
        ).toBeNull();
        expect(
          ctx.sqlite
            .prepare(
              "SELECT value FROM permission_entries WHERE permission_id = ?1 AND group_id = 0 AND user_id = ?2",
            )
            .get(definition("admin.permissions"), first.id),
        ).toEqual({ value: result });
        expect(can(ctx, userActor(first), "admin.permissions")).toBe(result === 1);
        expect(actual(ctx, first.id)).toEqual(expected(ctx, first.id));
      });

  for (const table of ["user_groups", "user_group_grants", "shop_group_grants"] as const)
    test(`repairs both members after a legacy ${table} ownership update`, () => {
      const { ctx, first, second, consistent } = beforeCombinationUpdateTriggers();
      if (table === "user_groups")
        ctx.sqlite
          .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 4, 0)")
          .run(first.id);
      else if (table === "user_group_grants") {
        ctx.sqlite.run(
          "INSERT INTO promotions (id, title, group_ids, created_at, updated_at) VALUES (1, 'Legacy', '[4]', 0, 0)",
        );
        ctx.sqlite
          .prepare(
            "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, 1, 4, 0)",
          )
          .run(first.id);
      } else
        ctx.sqlite
          .prepare(
            "INSERT INTO shop_group_grants (user_id, inventory_id, group_id, created_at) VALUES (?1, 1, 4, 0)",
          )
          .run(first.id);
      ctx.sqlite
        .prepare(`UPDATE ${table} SET user_id = ?1 WHERE user_id = ?2`)
        .run(second.id, first.id);
      expect(actual(ctx, first.id)).not.toEqual(expected(ctx, first.id));
      expect(actual(ctx, second.id)).not.toEqual(expected(ctx, second.id));
      expect(can(ctx, userActor(first), "admin.permissions")).toBe(true);
      expect(can(ctx, userActor(second), "admin.permissions")).toBe(false);

      applyMigrations(ctx, 17, 18);

      consistent();
      expect(can(ctx, userActor(first), "admin.permissions")).toBe(false);
      expect(can(ctx, userActor(second), "admin.permissions")).toBe(true);
    });

  for (const table of ["permission_entries", "shop_permission_grants"] as const)
    test(`repairs private and shared combinations after a legacy ${table} ownership update`, () => {
      const { ctx, first, second, definition, consistent } = beforeCombinationUpdateTriggers();
      if (table === "permission_entries")
        ctx.sqlite
          .prepare(
            "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 0, ?2, 1)",
          )
          .run(definition("admin.permissions"), first.id);
      else
        ctx.sqlite
          .prepare(
            "INSERT INTO shop_permission_grants (user_id, inventory_id, permission_id, value, created_at) VALUES (?1, 1, ?2, 1, 0)",
          )
          .run(first.id, definition("admin.permissions"));
      ctx.sqlite
        .prepare(`UPDATE ${table} SET user_id = ?1 WHERE user_id = ?2`)
        .run(second.id, first.id);
      expect(actual(ctx, first.id).user_id).toBe(first.id);
      expect(actual(ctx, second.id).user_id).toBe(0);

      applyMigrations(ctx, 17, 18);

      consistent();
      expect(actual(ctx, first.id).user_id).toBe(0);
      expect(actual(ctx, second.id).user_id).toBe(second.id);
      expect(can(ctx, userActor(first), "admin.permissions")).toBe(false);
      expect(can(ctx, userActor(second), "admin.permissions")).toBe(true);
    });

  test("rebuilds missing combinations from every group source, invalidates caches, and can run twice", () => {
    const { ctx, first, group, consistent } = beforeCombinationUpdateTriggers();
    const hand = group("Hand");
    const automatic = group("Automatic");
    const bought = group("Bought");
    const replacement = group("Replacement");
    ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(first.id, hand);
    ctx.sqlite.run(
      "INSERT INTO promotions (id, title, group_ids, created_at, updated_at) VALUES (1, 'Legacy', '[]', 0, 0)",
    );
    ctx.sqlite
      .prepare(
        "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, 1, ?2, 0)",
      )
      .run(first.id, automatic);
    ctx.sqlite
      .prepare(
        "INSERT INTO shop_group_grants (user_id, inventory_id, group_id, created_at) VALUES (?1, 1, ?2, 0)",
      )
      .run(first.id, bought);
    ctx.sqlite
      .prepare("UPDATE user_groups SET group_id = ?1 WHERE user_id = ?2")
      .run(replacement, first.id);
    const desired = expected(ctx, first.id);
    expect(
      ctx.sqlite
        .prepare("SELECT id FROM permission_combinations WHERE user_id = ?1 AND group_ids = ?2")
        .get(desired.user_id, desired.group_ids),
    ).toBeNull();
    const version = () =>
      ctx.sqlite
        .prepare<{ version: number }, []>(
          "SELECT version FROM cache_versions WHERE key = 'permissions'",
        )
        .get()!.version;
    const previousVersion = version();

    applyMigrations(ctx, 17, 18);

    consistent();
    expect(actual(ctx, first.id).group_ids).toBe([2, automatic, bought, replacement].join(","));
    expect(version()).toBeGreaterThan(previousVersion);
    const combinations = ctx.sqlite
      .prepare("SELECT * FROM permission_combinations ORDER BY id")
      .all();
    applyMigrations(ctx, 18, 18);
    consistent();
    expect(ctx.sqlite.prepare("SELECT * FROM permission_combinations ORDER BY id").all()).toEqual(
      combinations,
    );
  });

  test("repairs 60,000 members across 3,900 combinations using indexed lookups", () => {
    const { ctx, first } = beforeCombinationUpdateTriggers();
    ctx.sqlite.transaction(() => {
      ctx.sqlite.run(
        "WITH RECURSIVE numbers(n) AS (VALUES (100) UNION ALL SELECT n + 1 FROM numbers WHERE n < 3999) INSERT INTO groups (id, title, rank) SELECT n, 'Group ' || n, 5 FROM numbers",
      );
      ctx.sqlite.run(
        "WITH RECURSIVE numbers(n) AS (VALUES (10) UNION ALL SELECT n + 1 FROM numbers WHERE n < 60009) INSERT INTO auth_user (id, name, email, email_verified, username, display_username, created_at, updated_at) SELECT n, 'member' || n, 'member' || n || '@example.test', 0, 'member' || n, 'member' || n, 0, 0 FROM numbers",
      );
      ctx.sqlite.run(
        "INSERT INTO users (id, username, username_key, group_id, created_at) SELECT id, username, username, 100 + (id % 3900), 0 FROM auth_user WHERE id >= 10",
      );
      ctx.sqlite
        .prepare(
          "UPDATE users SET permission_combination_id = (SELECT permission_combination_id FROM users WHERE id = ?1) WHERE id >= 10",
        )
        .run(first.id);
    })();
    const mismatches = () =>
      ctx.sqlite
        .prepare<{ count: number }, []>(
          "SELECT count(*) AS count FROM users u JOIN permission_combinations c ON c.id = u.permission_combination_id WHERE u.id >= 10 AND c.group_ids <> CAST(u.group_id AS TEXT)",
        )
        .get()!.count;
    expect(mismatches()).toBe(60_000);
    applyMigrations(ctx, 17, 17);
    const statements = readFileSync(
      new URL("../../drizzle/0018_repair_permission_data.sql", import.meta.url),
      "utf8",
    ).split("--> statement-breakpoint");
    ctx.sqlite.transaction(() => {
      for (const sql of statements) {
        if (
          sql.includes("INSERT INTO repaired_permission_combinations") ||
          sql.includes("UPDATE users SET permission_combination_id = c.id")
        ) {
          const query = ctx.sqlite.prepare<{ detail: string }, []>(`EXPLAIN QUERY PLAN ${sql}`);
          const details = query.all().map((row) => row.detail);
          query.finalize();
          if (sql.includes("INSERT INTO repaired_permission_combinations")) {
            // One outer users scan is required; each member's sources must be index seeks.
            for (const table of [
              "permission_entries",
              "shop_permission_grants",
              "user_groups",
              "user_group_grants",
              "shop_group_grants",
            ]) {
              expect(details.some((detail) => detail.startsWith(`SEARCH ${table} USING`))).toBe(
                true,
              );
              expect(details.some((detail) => detail.startsWith(`SCAN ${table}`))).toBe(false);
            }
          } else {
            expect(
              details.some((detail) =>
                detail.startsWith("SEARCH c USING COVERING INDEX permission_combinations_key"),
              ),
            ).toBe(true);
            // SQLite may choose either users or the temporary table as the outer scan.
            expect(
              details.some((detail) => /^SEARCH (users|r) USING INTEGER PRIMARY KEY/.test(detail)),
            ).toBe(true);
          }
        }
        ctx.sqlite.run(sql);
      }
    })();
    expect(mismatches()).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ count: number }, []>(
          "SELECT count(DISTINCT permission_combination_id) AS count FROM users WHERE id >= 10",
        )
        .get()!.count,
    ).toBe(3_900);
    applyMigrations(ctx, 18, 18);
    expect(mismatches()).toBe(0);
  }, 20_000);

  test("a sole legacy promotion administrator survives a promotion group update and sweep", async () => {
    const { ctx, first, second, group } = beforeCombinationUpdateTriggers();
    const ordinary = group("Ordinary");
    ctx.sqlite
      .prepare(
        "INSERT INTO promotions (id, title, group_ids, created_at, updated_at) VALUES (1, 'Legacy', ?1, 0, 0)",
      )
      .run(JSON.stringify([4, ordinary]));
    ctx.sqlite
      .prepare(
        "INSERT INTO user_promotions (user_id, promotion_id, state, created_at, updated_at) VALUES (?1, 1, 'auto', 0, 0)",
      )
      .run(first.id);
    ctx.sqlite
      .prepare(
        "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, 1, 4, 0), (?1, 1, ?2, 0)",
      )
      .run(first.id, ordinary);
    expect(can(ctx, userActor(first), "admin.permissions")).toBe(true);
    expect(can(ctx, userActor(second), "admin.permissions")).toBe(false);

    applyMigrations(ctx, 17, 18);
    await execute(ctx, getOperation("promotions.update"), userActor(first), {
      promotionId: 1,
      groupIds: [ordinary],
    });
    sweepChunk(ctx);

    expect(can(ctx, userActor(first), "admin.permissions")).toBe(true);
    expect(can(ctx, userActor(second), "admin.permissions")).toBe(false);
    expect(
      ctx.sqlite.prepare("SELECT group_id FROM user_groups WHERE user_id = ?1").all(first.id),
    ).toEqual([{ group_id: 4 }]);
    expect(
      ctx.sqlite.prepare("SELECT group_id FROM user_group_grants WHERE user_id = ?1").all(first.id),
    ).toEqual([{ group_id: ordinary }]);
  });

  for (const path of ["apply while deletion is pending", "deletion job"] as const)
    test(`a sole legacy promotion administrator survives ${path}`, async () => {
      const { ctx, first, second, group, definition } = beforeCombinationUpdateTriggers();
      const administering = group("Administering");
      ctx.sqlite.prepare("UPDATE users SET group_id = 4 WHERE id = ?1").run(second.id);
      ctx.sqlite
        .prepare(
          "UPDATE permission_entries SET value = 0 WHERE permission_id = ?1 AND group_id = 4",
        )
        .run(definition("admin.permissions"));
      ctx.sqlite
        .prepare(
          "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, ?2, 0, 1)",
        )
        .run(definition("admin.permissions"), administering);
      ctx.sqlite
        .prepare(
          "INSERT INTO promotions (id, title, group_ids, created_at, updated_at) VALUES (1, 'Legacy', ?1, 0, 0)",
        )
        .run(JSON.stringify([administering]));
      ctx.sqlite
        .prepare(
          "INSERT INTO user_promotions (user_id, promotion_id, state, created_at, updated_at) VALUES (?1, 1, 'auto', 0, 0)",
        )
        .run(first.id);
      ctx.sqlite
        .prepare(
          "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, 1, ?2, 0)",
        )
        .run(first.id, administering);
      expect(can(ctx, userActor(first), "admin.permissions")).toBe(true);
      expect(can(ctx, userActor(second), "admin.permissions")).toBe(false);

      applyMigrations(ctx, 17, 18);
      await execute(ctx, getOperation("promotions.delete"), userActor(second), { promotionId: 1 });
      if (path === "apply while deletion is pending") {
        // This database stops at an early migration; the erased-member check reads a later column.
        ctx.sqlite.run("ALTER TABLE users ADD COLUMN erased_at integer");
        await execute(ctx, getOperation("promotions.apply"), userActor(second), {
          promotionId: 1,
          userId: first.id,
          action: "reset",
        });
      } else deletePromotionChunk(ctx, { promotionId: 1, after: 0, actorId: second.id });

      expect(can(ctx, userActor(first), "admin.permissions")).toBe(true);
      expect(can(ctx, userActor(second), "admin.permissions")).toBe(false);
      expect(
        ctx.sqlite.prepare("SELECT group_id FROM user_groups WHERE user_id = ?1").all(first.id),
      ).toEqual([{ group_id: administering }]);
      expect(
        ctx.sqlite
          .prepare("SELECT group_id FROM user_group_grants WHERE user_id = ?1")
          .all(first.id),
      ).toEqual([]);
    });

  for (const value of [1, -1])
    for (const state of ["active", "inactive", "deleting", "group removed"] as const)
      test(`preserves legacy promotion memberships with admin.permissions=${value} (${state})`, () => {
        const { ctx, first, second, group, definition } = beforeCombinationUpdateTriggers();
        const protectedGroup = group("Protected");
        const ordinary = group("Ordinary");
        const groupIds =
          state === "deleting"
            ? []
            : state === "group removed"
              ? [ordinary]
              : [protectedGroup, ordinary, protectedGroup];
        ctx.sqlite
          .prepare(
            "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, ?2, 0, ?3)",
          )
          .run(definition("admin.permissions"), protectedGroup, value);
        ctx.sqlite
          .prepare(
            "INSERT INTO promotions (id, title, is_active, group_ids, created_at, updated_at) VALUES (1, 'Legacy', ?1, ?2, 0, 0), (2, 'Duplicate grant', 1, ?2, 0, 0)",
          )
          .run(Number(state === "active" || state === "group removed"), JSON.stringify(groupIds));
        for (const user of [first, second]) {
          ctx.sqlite
            .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 4, 0)")
            .run(user.id);
          ctx.sqlite
            .prepare(
              "INSERT INTO user_promotions (user_id, promotion_id, state, created_at, updated_at) VALUES (?1, 1, 'auto', 0, 0), (?1, 2, 'auto', 0, 0)",
            )
            .run(user.id);
          ctx.sqlite
            .prepare(
              "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, 1, ?2, 10), (?1, 2, ?2, 20), (?1, 1, ?3, 10)",
            )
            .run(user.id, protectedGroup, ordinary);
        }
        // A hand assignment must keep its original timestamp despite overlapping grants.
        ctx.sqlite
          .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 5)")
          .run(first.id, protectedGroup);
        expect(can(ctx, userActor(second), "admin.permissions")).toBe(value === 1);
        const before = [first, second].map((user) => expected(ctx, user.id));

        applyMigrations(ctx, 17, 18);

        expect(
          ctx.sqlite
            .prepare(
              "SELECT user_id, created_at FROM user_groups WHERE group_id = ?1 ORDER BY user_id",
            )
            .all(protectedGroup),
        ).toEqual([
          { user_id: first.id, created_at: 5 },
          { user_id: second.id, created_at: 10 },
        ]);
        expect(
          ctx.sqlite
            .prepare("SELECT id FROM user_group_grants WHERE group_id = ?1")
            .all(protectedGroup),
        ).toEqual([]);
        expect(ctx.sqlite.prepare("SELECT group_ids FROM promotions ORDER BY id").all()).toEqual([
          { group_ids: JSON.stringify(groupIds.filter((id) => id !== protectedGroup)) },
          { group_ids: JSON.stringify(groupIds.filter((id) => id !== protectedGroup)) },
        ]);
        for (const [index, user] of [first, second].entries()) {
          expect(actual(ctx, user.id)).toEqual(before[index]!);
          expect(can(ctx, userActor(user), "admin.permissions")).toBe(value === 1);
        }
        applyMigrations(ctx, 18, 18);
        evaluateMember(ctx, second.id);
        sweepChunk(ctx);
        if (state === "deleting")
          deletePromotionChunk(ctx, { promotionId: 1, after: 0, actorId: null });
        for (const user of [first, second]) {
          expect(can(ctx, userActor(user), "admin.permissions")).toBe(value === 1);
          expect(
            ctx.sqlite
              .prepare("SELECT id FROM user_groups WHERE user_id = ?1 AND group_id = ?2")
              .get(user.id, protectedGroup),
          ).not.toBeNull();
        }
      });
});

describe("0018 moves legacy admin.permissions decisions without changing anyone's outcome", () => {
  const MEMBER = 2;
  const UNCONFIRMED = 5;
  const KEY = "admin.permissions";

  function fixture() {
    const base = beforeCombinationUpdateTriggers();
    const { ctx, group, definition } = base;
    const permission = definition(KEY);
    const setEntry = (groupId: number, userId: number, value: number) =>
      ctx.sqlite
        .prepare(
          "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, ?2, ?3, ?4)",
        )
        .run(permission, groupId, userId, value);
    const entryGroup = (title: string, value: number) => {
      const id = group(title);
      setEntry(id, 0, value);
      return id;
    };
    const hand = (userId: number, groupId: number) =>
      ctx.sqlite
        .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
        .run(userId, groupId);
    const promoted = (userId: number, groupId: number) => {
      ctx.sqlite.run(
        "INSERT OR IGNORE INTO promotions (id, title, group_ids, created_at, updated_at) VALUES (1, 'Legacy', '[]', 0, 0)",
      );
      ctx.sqlite
        .prepare(
          "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, 1, ?2, 0)",
        )
        .run(userId, groupId);
    };
    const bought = (userId: number, groupId: number) =>
      ctx.sqlite
        .prepare(
          "INSERT INTO shop_group_grants (user_id, inventory_id, group_id, created_at) VALUES (?1, 1, ?2, 0)",
        )
        .run(userId, groupId);
    const outcomes = (users: { id: number; groupId: number }[]) =>
      users.map((user) => can(ctx, userActor(user), KEY));
    const memberEntries = () =>
      ctx.sqlite
        .prepare<{ user_id: number; value: number }, [number]>(
          "SELECT user_id, value FROM permission_entries WHERE permission_id = ?1 AND group_id = 0 ORDER BY user_id",
        )
        .all(permission);
    const groupEntries = (groupId: number) =>
      ctx.sqlite
        .prepare("SELECT value FROM permission_entries WHERE permission_id = ?1 AND group_id = ?2")
        .all(permission, groupId);
    const count = (sql: string) =>
      ctx.sqlite.prepare<{ n: number }, []>(`SELECT count(*) AS n FROM ${sql}`).get()!.n;
    const snapshot = () =>
      Object.fromEntries(
        [
          "permission_entries",
          "permission_combinations",
          "permission_layer_versions",
          "user_groups",
          "user_group_grants",
          "shop_group_grants",
        ]
          .map((table) => [table, ctx.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()])
          .concat([
            ["users", ctx.sqlite.prepare("SELECT id, permission_combination_id FROM users").all()],
            [
              "cache_versions",
              ctx.sqlite.prepare("SELECT * FROM cache_versions WHERE key <> 'permissions'").all(),
            ],
          ]),
      );
    const permissionsVersion = () =>
      ctx.sqlite
        .prepare<{ version: number }, []>(
          "SELECT version FROM cache_versions WHERE key = 'permissions'",
        )
        .get()!.version;
    return {
      ...base,
      setEntry,
      entryGroup,
      hand,
      promoted,
      bought,
      outcomes,
      memberEntries,
      groupEntries,
      count,
      snapshot,
      permissionsVersion,
      permission,
    };
  }

  /** A Member never, and a member for each way of holding an allow besides it. */
  function memberNeverScenario() {
    const f = fixture();
    const { ctx, setEntry, entryGroup, hand, promoted, bought, permission } = f;
    setEntry(MEMBER, 0, -1);
    const primary = entryGroup("Primary allow", 1);
    const secondary = entryGroup("Secondary allow", 1);
    const automatic = entryGroup("Promotion allow", 1);
    const shop = entryGroup("Shop allow", 1);
    const other = entryGroup("Other never", -1);
    const plain = insertUser(ctx);
    const viaPrimary = insertUser(ctx, { groupId: primary });
    hand(viaPrimary.id, MEMBER);
    const viaHand = insertUser(ctx);
    hand(viaHand.id, secondary);
    const viaPromotion = insertUser(ctx);
    promoted(viaPromotion.id, automatic);
    const viaShopGroup = insertUser(ctx);
    bought(viaShopGroup.id, shop);
    const viaMemberEntry = insertUser(ctx);
    setEntry(0, viaMemberEntry.id, 1);
    const viaPurchase = insertUser(ctx);
    ctx.sqlite
      .prepare(
        "INSERT INTO shop_permission_grants (user_id, inventory_id, permission_id, value, created_at) VALUES (?1, 1, ?2, 1, 0)",
      )
      .run(viaPurchase.id, permission);
    const alsoDenied = insertUser(ctx);
    hand(alsoDenied.id, secondary);
    hand(alsoDenied.id, other);
    const memberNo = insertUser(ctx);
    setEntry(0, memberNo.id, 0);
    const memberNever = insertUser(ctx);
    setEntry(0, memberNever.id, -1);
    const administrator = insertUser(ctx, { groupId: 4 });
    const users = [
      plain,
      viaPrimary,
      viaHand,
      viaPromotion,
      viaShopGroup,
      viaMemberEntry,
      viaPurchase,
      alsoDenied,
      memberNo,
      memberNever,
      administrator,
    ];
    return {
      ...f,
      users,
      materialised: [
        viaPrimary,
        viaHand,
        viaPromotion,
        viaShopGroup,
        viaMemberEntry,
        viaPurchase,
      ].map((user) => user.id),
      memberNo,
      memberNever,
      administrator,
    };
  }

  test("a Member never with many members and no allow writes no member entries", () => {
    const f = fixture();
    const { ctx, setEntry, outcomes, memberEntries, groupEntries, count } = f;
    setEntry(MEMBER, 0, -1);
    ctx.sqlite.transaction(() => {
      ctx.sqlite.run(
        "WITH RECURSIVE numbers(n) AS (VALUES (1000) UNION ALL SELECT n + 1 FROM numbers WHERE n < 3999) INSERT INTO auth_user (id, name, email, email_verified, username, display_username, created_at, updated_at) SELECT n, 'member' || n, 'member' || n || '@example.test', 0, 'member' || n, 'member' || n, 0, 0 FROM numbers",
      );
      ctx.sqlite.run(
        "INSERT INTO users (id, username, username_key, group_id, created_at) SELECT id, username, username, 2, 0 FROM auth_user WHERE id >= 1000",
      );
    })();
    const sample = [f.first, f.second, ...[1000, 2000, 3999].map((id) => ({ id, groupId: 2 }))];
    const before = outcomes(sample);
    expect(before.every((allowed) => !allowed)).toBe(true);
    expect(count("users")).toBe(3_002);
    const combinations = count("permission_combinations");

    applyMigrations(ctx, 17, 18);

    expect(groupEntries(MEMBER)).toEqual([]);
    expect(memberEntries()).toEqual([]);
    expect(count("permission_combinations")).toBe(combinations);
    expect(count("permission_combinations")).toBeLessThanOrEqual(6);
    expect(outcomes(sample)).toEqual(before);
  });

  test("a Member never is written as a private never only where an allow would otherwise win", () => {
    const {
      ctx,
      users,
      materialised,
      outcomes,
      memberEntries,
      groupEntries,
      count,
      administrator,
      memberNo,
      memberNever,
    } = memberNeverScenario();
    const before = outcomes(users);
    expect(before).toEqual(users.map((user) => user.id === administrator.id));

    applyMigrations(ctx, 17, 18);

    expect(groupEntries(MEMBER)).toEqual([]);
    expect(memberEntries()).toEqual(
      [
        ...materialised.map((user_id) => ({ user_id, value: -1 })),
        { user_id: memberNo.id, value: 0 },
        { user_id: memberNever.id, value: -1 },
      ].sort((a, b) => a.user_id - b.user_id),
    );
    expect(outcomes(users)).toEqual(before);
    expect(count("user_group_grants")).toBe(0);
    expect(
      ctx.sqlite
        .prepare(
          "SELECT id FROM users WHERE permission_combination_id NOT IN (SELECT id FROM permission_combinations)",
        )
        .all(),
    ).toEqual([]);
  });

  test("running the migration statements twice changes only the permissions cache version", () => {
    const { ctx, users, outcomes, snapshot, permissionsVersion, memberEntries, materialised } =
      memberNeverScenario();
    const before = outcomes(users);
    applyMigrations(ctx, 17, 18);
    expect(memberEntries().filter((entry) => entry.value === -1)).toHaveLength(
      materialised.length + 1,
    );
    const first = snapshot();
    const version = permissionsVersion();

    applyMigrations(ctx, 18, 18);

    expect(snapshot()).toEqual(first);
    expect(permissionsVersion()).toBeGreaterThan(version);
    expect(outcomes(users)).toEqual(before);
  });

  for (const [value, expected] of [
    [1, { entries: ["both", "both"], outcome: [true, true] }],
    [0, { entries: [], outcome: [false, true] }],
    [-1, { entries: ["second"], outcome: [false, false] }],
  ] as const)
    test(`an Unconfirmed entry of ${value} keeps every holder's outcome`, () => {
      const { ctx, setEntry, entryGroup, hand, outcomes, memberEntries, groupEntries } = fixture();
      const allow = entryGroup("Allow", 1);
      setEntry(UNCONFIRMED, 0, value);
      const alone = insertUser(ctx, { groupId: UNCONFIRMED });
      const allowed = insertUser(ctx, { groupId: UNCONFIRMED });
      hand(allowed.id, allow);
      const users = [alone, allowed];
      const before = outcomes(users);
      expect(before).toEqual([...expected.outcome]);

      applyMigrations(ctx, 17, 18);

      expect(groupEntries(UNCONFIRMED)).toEqual([]);
      expect(memberEntries()).toEqual(
        expected.entries.length === 0
          ? []
          : expected.entries[0] === "both"
            ? [
                { user_id: alone.id, value: 1 },
                { user_id: allowed.id, value: 1 },
              ]
            : [{ user_id: allowed.id, value: -1 }],
      );
      expect(outcomes(users)).toEqual(before);
    });

  test("an Unconfirmed allow beside a Member never leaves no member entry and no administrator", () => {
    const { ctx, setEntry, hand, outcomes, memberEntries } = fixture();
    setEntry(UNCONFIRMED, 0, 1);
    setEntry(MEMBER, 0, -1);
    const both = insertUser(ctx, { groupId: UNCONFIRMED });
    hand(both.id, MEMBER);
    const unconfirmed = insertUser(ctx, { groupId: UNCONFIRMED });
    expect(outcomes([both, unconfirmed])).toEqual([false, true]);

    applyMigrations(ctx, 17, 18);

    expect(memberEntries()).toEqual([{ user_id: unconfirmed.id, value: 1 }]);
    expect(outcomes([both, unconfirmed])).toEqual([false, true]);
  });

  test("an orphan promotion grant does not abort the migration or create a membership", () => {
    const { ctx, first, promoted, entryGroup, count } = fixture();
    const allow = entryGroup("Allow", 1);
    promoted(first.id, allow);
    ctx.sqlite.run("PRAGMA foreign_keys = OFF");
    ctx.sqlite
      .prepare(
        "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (999999, 1, ?1, 0), (999999, 1, 4, 0)",
      )
      .run(allow);
    ctx.sqlite.run("PRAGMA foreign_keys = ON");
    expect(count("user_group_grants WHERE user_id = 999999")).toBe(2);

    applyMigrations(ctx, 17, 18);

    expect(count("user_groups WHERE user_id = 999999")).toBe(0);
    expect(count("user_group_grants WHERE user_id = 999999")).toBe(0);
    expect(
      ctx.sqlite.prepare("SELECT group_id FROM user_groups WHERE user_id = ?1").all(first.id),
    ).toEqual([{ group_id: allow }]);
  });

  test("a promotion grant of a group that no longer exists does not abort the migration", () => {
    const { ctx, first, definition, promoted, count } = fixture();
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 9999, 0, 1)",
      )
      .run(definition(KEY));
    promoted(first.id, 4);
    ctx.sqlite.run("PRAGMA foreign_keys = OFF");
    ctx.sqlite.run(
      "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (" +
        `${first.id}, 1, 9999, 0)`,
    );
    ctx.sqlite.run("PRAGMA foreign_keys = ON");

    applyMigrations(ctx, 17, 18);

    expect(count("user_groups WHERE group_id = 9999")).toBe(0);
    expect(count("user_group_grants")).toBe(0);
    expect(count(`user_groups WHERE user_id = ${first.id} AND group_id = 4`)).toBe(1);
  });
});

describe("combination triggers cover UPDATE of the owner and of the group", () => {
  test("permission_entries: a member entry moved to another member", () => {
    const { ctx, first, second, definition, consistent } = setup();
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 0, ?2, -1)",
      )
      .run(definition("search.use"), first.id);
    expect(can(ctx, userActor(first), "search.use")).toBe(false);
    expect(can(ctx, userActor(second), "search.use")).toBe(true);
    ctx.sqlite
      .prepare("UPDATE permission_entries SET user_id = ?1 WHERE user_id = ?2")
      .run(second.id, first.id);
    consistent();
    expect(can(ctx, userActor(first), "search.use")).toBe(true);
    expect(can(ctx, userActor(second), "search.use")).toBe(false);
  });

  test("permission_entries: a member entry turned into a group entry and back", () => {
    const { ctx, first, group, definition, consistent } = setup();
    const groupId = group("Holders");
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 0, ?2, -1)",
      )
      .run(definition("search.use"), first.id);
    ctx.sqlite
      .prepare("UPDATE permission_entries SET user_id = 0, group_id = ?1 WHERE user_id = ?2")
      .run(groupId, first.id);
    consistent();
    expect(actual(ctx, first.id).user_id).toBe(0);
    expect(can(ctx, userActor(first), "search.use")).toBe(true);
    ctx.sqlite
      .prepare("UPDATE permission_entries SET user_id = ?1, group_id = 0 WHERE group_id = ?2")
      .run(first.id, groupId);
    consistent();
    expect(can(ctx, userActor(first), "search.use")).toBe(false);
  });

  for (const table of ["user_groups", "user_group_grants", "shop_group_grants"] as const)
    test(`${table}: a membership moved to another member or another group`, () => {
      const { ctx, first, second, group, definition, consistent } = setup();
      const [holders, others] = [group("Holders"), group("Others")];
      const never = ctx.sqlite.prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, ?2, 0, -1)",
      );
      never.run(definition("search.use"), holders);
      never.run(definition("profile.view"), others);
      if (table === "user_groups")
        ctx.sqlite
          .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
          .run(first.id, holders);
      else if (table === "user_group_grants") {
        ctx.sqlite.run(
          "INSERT INTO promotions (id, title, group_ids, created_at, updated_at) VALUES (1, 'P', '[]', 0, 0)",
        );
        ctx.sqlite
          .prepare(
            "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, 1, ?2, 0)",
          )
          .run(first.id, holders);
      } else
        ctx.sqlite
          .prepare(
            "INSERT INTO shop_group_grants (user_id, inventory_id, group_id, created_at) VALUES (?1, 1, ?2, 0)",
          )
          .run(first.id, holders);
      expect(can(ctx, userActor(first), "search.use")).toBe(false);
      ctx.sqlite
        .prepare(`UPDATE ${table} SET user_id = ?1 WHERE user_id = ?2`)
        .run(second.id, first.id);
      consistent();
      expect(can(ctx, userActor(first), "search.use")).toBe(true);
      expect(can(ctx, userActor(second), "search.use")).toBe(false);
      ctx.sqlite
        .prepare(`UPDATE ${table} SET group_id = ?1 WHERE user_id = ?2`)
        .run(others, second.id);
      consistent();
      expect(can(ctx, userActor(second), "search.use")).toBe(true);
      expect(can(ctx, userActor(second), "profile.view", { ownerId: first.id })).toBe(false);
    });

  test("shop_permission_grants: a purchased permission moved to another member", () => {
    const { ctx, first, second, definition, consistent } = setup();
    const quota = () =>
      [first, second].map((user) =>
        permissionValue(ctx, userActor(user), "attachment.storageQuota"),
      );
    const [base] = quota();
    ctx.sqlite
      .prepare(
        "INSERT INTO shop_permission_grants (user_id, inventory_id, permission_id, value, created_at) VALUES (?1, 1, ?2, -1, 0)",
      )
      .run(first.id, definition("attachment.storageQuota"));
    expect(quota()).toEqual([-1, base!]);
    ctx.sqlite
      .prepare("UPDATE shop_permission_grants SET user_id = ?1 WHERE user_id = ?2")
      .run(second.id, first.id);
    consistent();
    expect(quota()).toEqual([base!, -1]);
  });
});
