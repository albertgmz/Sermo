import { describe, expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import { usersRelations } from "../../contracts/social";
import { execute } from "../../operation";
import { countStatements } from "../feed/fixtures.test";
import { relationsSql, usersRelationsOp } from "./index";

type User = ReturnType<typeof insertUser>;

function relations(ctx: Ctx, actor: Parameters<typeof execute>[2], userIds: number[]) {
  return execute(ctx, usersRelationsOp, actor, { userIds });
}

async function one(ctx: Ctx, actor: Parameters<typeof execute>[2], user: User) {
  const { items } = await relations(ctx, actor, [user.id]);
  return items[0];
}

function follow(ctx: Ctx, who: User, whom: User) {
  ctx.sqlite
    .prepare("INSERT INTO user_follows (user_id, followed_id, created_at) VALUES (?1, ?2, 0)")
    .run(who.id, whom.id);
}

function block(ctx: Ctx, who: User, whom: User) {
  ctx.sqlite
    .prepare("INSERT INTO user_blocks (user_id, blocked_id, created_at) VALUES (?1, ?2, 0)")
    .run(who.id, whom.id);
}

function deny(ctx: Ctx, user: User, permission: string) {
  const id = ctx.sqlite
    .prepare<{ id: number }, [string]>("SELECT id FROM permission_definitions WHERE key = ?1")
    .get(permission)!.id;
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 0, ?2, -1)",
    )
    .run(id, user.id);
  invalidate(ctx, "permissions");
}

function scene() {
  const ctx = createTestContext();
  return { ctx, viewer: insertUser(ctx), other: insertUser(ctx), third: insertUser(ctx) };
}

describe("users.relations", () => {
  test("a guest gets false for all three, and unknown ids are left out", async () => {
    const s = scene();
    follow(s.ctx, s.viewer, s.other);
    const { items } = await relations(s.ctx, GUEST, [s.other.id, 999999]);
    expect(items).toEqual([
      {
        userId: s.other.id,
        following: false,
        canFollow: false,
        canMessage: false,
        blocking: false,
        canBlock: false,
      },
    ]);
  });

  test("a member sees who they follow and may follow and message the rest", async () => {
    const s = scene();
    follow(s.ctx, s.viewer, s.other);
    const { items } = await relations(s.ctx, userActor(s.viewer), [s.other.id, s.third.id, 999999]);
    expect(items.find((i) => i.userId === s.other.id)).toEqual({
      userId: s.other.id,
      following: true,
      canFollow: true,
      canMessage: true,
      blocking: false,
      canBlock: true,
    });
    expect(items.find((i) => i.userId === s.third.id)).toEqual({
      userId: s.third.id,
      following: false,
      canFollow: true,
      canMessage: true,
      blocking: false,
      canBlock: true,
    });
    expect(items).toHaveLength(2);
    // Someone else's follow does not count.
    expect((await one(s.ctx, userActor(s.third), s.other))?.following).toBe(false);
  });

  test("yourself: nothing is offered", async () => {
    const s = scene();
    expect(await one(s.ctx, userActor(s.viewer), s.viewer)).toEqual({
      userId: s.viewer.id,
      following: false,
      canFollow: false,
      canMessage: false,
      blocking: false,
      canBlock: false,
    });
  });

  test("without member.follow the member cannot follow but can still message", async () => {
    const s = scene();
    deny(s.ctx, s.viewer, "member.follow");
    expect(await one(s.ctx, userActor(s.viewer), s.other)).toMatchObject({
      canFollow: false,
      canMessage: true,
    });
  });

  test("without conversation.start the member cannot message but can still follow", async () => {
    const s = scene();
    deny(s.ctx, s.viewer, "conversation.start");
    expect(await one(s.ctx, userActor(s.viewer), s.other)).toMatchObject({
      canFollow: true,
      canMessage: false,
    });
  });

  test("a recipient limit of zero removes only the message flag", async () => {
    const s = scene();
    const id = s.ctx.sqlite
      .prepare<{ id: number }, [string]>("SELECT id FROM permission_definitions WHERE key = ?1")
      .get("conversation.maxRecipients")!.id;
    s.ctx.sqlite
      .prepare(
        "INSERT OR REPLACE INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 2, 0, 0)",
      )
      .run(id);
    invalidate(s.ctx, "permissions");
    expect(await one(s.ctx, userActor(s.viewer), s.other)).toMatchObject({
      canFollow: true,
      canMessage: false,
    });
  });

  test("a conversations restriction removes only the message flag", async () => {
    const s = scene();
    s.ctx.sqlite
      .prepare("UPDATE users SET restricted_conversations_until = ?1 WHERE id = ?2")
      .run(s.ctx.now() + 86_400_000, s.viewer.id);
    expect(await one(s.ctx, userActor(s.viewer), s.other)).toMatchObject({
      canFollow: true,
      canMessage: false,
    });
  });

  test("a member who blocks the viewer is left out, as an unknown id", async () => {
    const s = scene();
    block(s.ctx, s.other, s.viewer);
    const { items } = await relations(s.ctx, userActor(s.viewer), [s.other.id, s.third.id]);
    expect(items.map((i) => i.userId)).toEqual([s.third.id]);
    expect(items[0]?.canMessage).toBe(true);
  });

  test("staff see a member who blocks them and may still message them, but not follow", async () => {
    const s = scene();
    const moderator = insertUser(s.ctx, { groupId: 3 });
    block(s.ctx, s.other, moderator);
    expect(await one(s.ctx, userActor(moderator), s.other)).toMatchObject({
      blocking: false,
      canFollow: false,
      canMessage: true,
    });
  });

  test("a member the viewer blocks can be neither messaged nor followed", async () => {
    const s = scene();
    block(s.ctx, s.viewer, s.other);
    expect(await one(s.ctx, userActor(s.viewer), s.other)).toMatchObject({
      canFollow: false,
      canMessage: false,
    });
  });

  test("the viewer's own block shows as blocking, someone else's does not", async () => {
    const s = scene();
    block(s.ctx, s.viewer, s.other);
    expect(await one(s.ctx, userActor(s.viewer), s.other)).toMatchObject({
      blocking: true,
      canBlock: true,
    });
    expect((await one(s.ctx, userActor(s.third), s.other))?.blocking).toBe(false);
  });

  test("staff can be blocked, and without member.block nobody can, but a block stays undoable", async () => {
    const s = scene();
    const moderator = insertUser(s.ctx, { groupId: 3 });
    expect((await one(s.ctx, userActor(s.viewer), moderator))?.canBlock).toBe(true);
    block(s.ctx, s.viewer, s.other);
    deny(s.ctx, s.viewer, "member.block");
    expect(await one(s.ctx, userActor(s.viewer), s.other)).toMatchObject({
      blocking: true,
      canBlock: false,
    });
    expect((await one(s.ctx, userActor(s.viewer), s.third))?.canBlock).toBe(false);
  });

  test("50 ids are answered in a fixed number of statements and 51 are refused", async () => {
    const s = scene();
    const ids = Array.from({ length: 50 }, () => insertUser(s.ctx).id);
    for (const id of ids.slice(0, 10)) follow(s.ctx, s.viewer, { id } as User);
    const actor = userActor(s.viewer);
    await relations(s.ctx, actor, ids.slice(0, 1));
    const many = await countStatements(s.ctx, () => relations(s.ctx, actor, ids));
    const single = await countStatements(s.ctx, () => relations(s.ctx, actor, ids.slice(0, 1)));
    expect(many).toBe(single);
    expect((await relations(s.ctx, actor, ids)).items).toHaveLength(50);
    expect(usersRelations.input.safeParse({ userIds: [...ids, s.other.id] }).success).toBe(false);
    expect(usersRelations.input.safeParse({ userIds: [] }).success).toBe(false);
  });

  test("the statement uses indexes", () => {
    const s = scene();
    expectNoTableScan(s.ctx, relationsSql, [s.viewer.id, JSON.stringify([s.other.id])]);
  });
});
