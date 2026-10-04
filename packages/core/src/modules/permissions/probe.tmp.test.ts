import { expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { execute } from "../../operation";
import { getNodeAccess, groupsUpdateOp, permissionsSetNodeOp, usersSetGroupOp, getNodeTree, viewableNodeIds } from "./index";
import { authLoginOp, authRegisterOp, ensureAdmin } from "../auth/index";

const ch = (nodeId: number, groupId: number, canView: boolean | null, canPost: boolean | null = null, canModerate: boolean | null = null) => ({ nodeId, groupId, canView, canPost, canModerate });

test("nasty trees", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const m = userActor(insertUser(ctx));
  const ids: number[] = [];
  let p: number | null = null;
  for (let i = 0; i < 6; i++) { p = insertNode(ctx, { parentId: p }).id; ids.push(p); }
  invalidate(ctx, "node_tree");
  // revoke at 1, regrant at 3 -> 1..5 hidden
  await execute(ctx, permissionsSetNodeOp, admin, ch(ids[1]!, 2, false));
  await execute(ctx, permissionsSetNodeOp, admin, ch(ids[3]!, 2, true));
  expect(ids.map((id) => getNodeAccess(ctx, m)(id).view)).toEqual([true, false, false, false, false, false]);
  // post revoked at 0, view ok; regrant post at 4
  await execute(ctx, permissionsSetNodeOp, admin, ch(ids[1]!, 2, null));
  await execute(ctx, permissionsSetNodeOp, admin, ch(ids[0]!, 2, null, false, true));
  await execute(ctx, permissionsSetNodeOp, admin, ch(ids[4]!, 2, null, true, false));
  expect(ids.map((id) => getNodeAccess(ctx, m)(id).post)).toEqual([false, false, false, false, true, true]);
  expect(ids.map((id) => getNodeAccess(ctx, m)(id).moderate)).toEqual([true, true, true, true, false, false]);
  // guest view override false at root then guest true deeper
  await execute(ctx, permissionsSetNodeOp, admin, ch(ids[2]!, 1, false));
  await execute(ctx, permissionsSetNodeOp, admin, ch(ids[3]!, 1, true));
  expect(ids.map((id) => getNodeAccess(ctx, GUEST)(id).view)).toEqual([true, true, false, false, false, false]);
  expect(getNodeAccess(ctx, m)(9999)).toEqual({ view: false, post: false, moderate: false });
  // tree change: move node 5 under root -> cache rebuild
  ctx.sqlite.run(`UPDATE nodes SET parent_id = ${ids[0]} WHERE id = ${ids[5]}`);
  invalidate(ctx, "node_tree");
  expect(getNodeAccess(ctx, GUEST)(ids[5]!).view).toBe(true);
  expect(viewableNodeIds(ctx, GUEST)).toContain(ids[5]!);
  // Guest group flag forced in DB -> still no post
  ctx.sqlite.run("UPDATE groups SET can_post = 1, is_moderator = 1 WHERE id = 1"); invalidate(ctx, "permissions");
  expect(getNodeAccess(ctx, GUEST)(ids[0]!)).toEqual({ view: true, post: false, moderate: false });
});

test("groups.update with explicit undefined title", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const r = await execute(ctx, groupsUpdateOp, admin, { groupId: 2, title: undefined, canReact: false }).catch((e) => e);
  console.log("explicit undefined:", r instanceof Error ? r.message : JSON.stringify(r));
  const raw = await groupsUpdateOp.run(ctx, admin, { groupId: 3, canReact: false });
  console.log("raw output keys:", Object.keys(raw as object));
});

test("last admin: two admin groups", async () => {
  const ctx = createTestContext();
  const a = insertUser(ctx, { groupId: 4 });
  const admin = userActor(a);
  // make moderator group admin with zero users; then demote group 4 -> must conflict
  await execute(ctx, groupsUpdateOp, admin, { groupId: 3, isAdmin: true });
  const r = await execute(ctx, groupsUpdateOp, admin, { groupId: 4, isAdmin: false }).catch((e) => e.constructor.name);
  console.log("demote 4 with empty admin group 3:", r);
  // move admin to group 3 (admin) then demote 4 (empty)
  await execute(ctx, usersSetGroupOp, admin, { userId: a.id, groupId: 3 });
  const r2 = await execute(ctx, groupsUpdateOp, userActor({ id: a.id, groupId: 3 }), { groupId: 4, isAdmin: false }).catch((e) => e.constructor.name);
  console.log("demote empty group 4:", typeof r2 === "string" ? r2 : "ok");
  const r3 = await execute(ctx, groupsUpdateOp, userActor({ id: a.id, groupId: 3 }), { groupId: 3, isAdmin: false }).catch((e) => e.constructor.name);
  console.log("demote last group 3:", typeof r3 === "string" ? r3 : "ok");
});

test("plans", () => {
  const ctx = createTestContext();
  for (const [sql, params] of [
    ["SELECT id, username, email, group_id, created_at, password_hash FROM users WHERE username_key = ?1 OR email = ?2 LIMIT 1", ["a", "a"]],
    ["SELECT u.id FROM users u JOIN groups g ON g.id = u.group_id WHERE g.is_admin = 1 LIMIT 1", []],
    ["SELECT id FROM users WHERE group_id = ?1 LIMIT 1", [4]],
    ["SELECT u.id FROM users u JOIN groups g ON g.id = u.group_id WHERE g.is_admin = 1 AND u.id != ?1 LIMIT 1", [1]],
    ["SELECT id, name, created_at, expires_at FROM api_tokens WHERE user_id = ?1 ORDER BY id DESC", [1]],
    ["DELETE FROM sessions WHERE expires_at <= ?1", [1]],
  ] as const) {
    const rows = ctx.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as any[]));
    console.log(sql.slice(0, 60), "=>", rows.map((r: any) => r.detail).join(" | "));
  }
});

test("login timing dummy vs real", async () => {
  const ctx = createTestContext();
  ctx.config.passwordHash = { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 };
  await execute(ctx, authRegisterOp, GUEST, { username: "Bob", email: "b@x.io", password: "password1" });
  const t = async (login: string) => { const s = performance.now(); await execute(ctx, authLoginOp, GUEST, { login, password: "nopenope" }).catch(() => 0); return performance.now() - s; };
  await t("bob"); await t("nobody");
  const k = []; const u = [];
  for (let i = 0; i < 5; i++) { k.push(await t("bob")); u.push(await t("nobody")); }
  console.log("known ms", k.map(Math.round), "unknown ms", u.map(Math.round));
});

test("ensureAdmin with existing username but different-case email collision", async () => {
  const ctx = createTestContext();
  insertUser(ctx, { username: "x1", email: "root@example.com" });
  const r = await ensureAdmin(ctx, { username: "Root", email: "ROOT@example.com", password: "password1" }).catch((e) => e.constructor.name + ":" + e.message);
  console.log("ensureAdmin email clash:", r);
});
