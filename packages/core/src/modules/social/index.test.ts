import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import { writeTx } from "../../db/tx";
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { dispatchEvents, publishEvent } from "../../events";
import { execute } from "../../operation";
import { conversationsCreateOp } from "../conversations";
import { profileCommentsCreateOp, profilePostsCreateOp } from "../profiles";
import {
  nodesUnwatchOp,
  nodesWatchOp,
  preferencesGetOp,
  preferencesUpdateOp,
  registerSocialJobs,
  threadsUnwatchOp,
  threadsWatchOp,
  usersFollowOp,
  usersIgnoreOp,
  usersListFollowersOp,
  usersListFollowingOp,
  usersListIgnoredOp,
  usersUnfollowOp,
  usersUnignoreOp,
  watchesListNodesOp,
  watchesListThreadsOp,
  watchSql,
} from "./index";

function fixture() {
  const ctx = createTestContext();
  const owner = insertUser(ctx);
  const other = insertUser(ctx);
  const staff = insertUser(ctx, { groupId: 3 });
  const node = insertNode(ctx, {});
  const category = insertNode(ctx, { type: "category" });
  invalidate(ctx, "node_tree");
  const now = ctx.now();
  const thread = ctx.sqlite
    .prepare<{ id: number }, [number, number, string, number]>(
      "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, ?3, ?4, ?4, ?2) RETURNING id",
    )
    .get(node.id, owner.id, "A thread", now)!.id;
  const post = ctx.sqlite
    .prepare<{ id: number }, [number, number, number]>(
      "INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, 0, ?3) RETURNING id",
    )
    .get(thread, owner.id, now)!.id;
  ctx.sqlite
    .prepare("UPDATE threads SET first_post_id = ?1, last_post_id = ?1 WHERE id = ?2")
    .run(post, thread);
  return { ctx, owner, other, staff, node, category, thread, post };
}
const call = execute;
function deny(ctx: Ctx, userId: number, permission: string): void {
  const id = ctx.sqlite
    .prepare<{ id: number }, [string]>("SELECT id FROM permission_definitions WHERE key = ?1")
    .get(permission)!.id;
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 0, ?2, -1)",
    )
    .run(id, userId);
  invalidate(ctx, "permissions");
}

describe("social", () => {
  test("thread and node watches update flags, paginate, and enforce visibility", async () => {
    const f = fixture();
    const actor = userActor(f.owner);
    await expect(call(f.ctx, threadsWatchOp, GUEST, { threadId: f.thread })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(
      call(f.ctx, threadsUnwatchOp, GUEST, { threadId: f.thread }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(call(f.ctx, nodesUnwatchOp, GUEST, { nodeId: f.node.id })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(call(f.ctx, watchesListThreadsOp, GUEST, { limit: 10 })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(call(f.ctx, watchesListNodesOp, GUEST, { limit: 10 })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(await call(f.ctx, threadsWatchOp, actor, { threadId: f.thread, email: true })).toEqual({
      watching: true,
      email: true,
    });
    await call(f.ctx, threadsWatchOp, actor, { threadId: f.thread, email: false });
    expect((await call(f.ctx, watchesListThreadsOp, actor, { limit: 10 })).items[0]?.email).toBe(
      false,
    );
    await call(f.ctx, nodesWatchOp, actor, { nodeId: f.node.id, mode: "posts", email: true });
    expect((await call(f.ctx, watchesListNodesOp, actor, { limit: 10 })).items[0]?.mode).toBe(
      "posts",
    );
    await expect(
      call(f.ctx, nodesWatchOp, actor, { nodeId: f.category.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    f.ctx.sqlite.prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1").run(f.thread);
    await expect(
      call(f.ctx, threadsWatchOp, userActor(f.other), { threadId: f.thread }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      (await call(f.ctx, watchesListThreadsOp, userActor(f.other), { limit: 10 })).items,
    ).toEqual([]);
    await call(f.ctx, threadsUnwatchOp, actor, { threadId: f.thread });
    await call(f.ctx, threadsUnwatchOp, actor, { threadId: f.thread });
    f.ctx.sqlite.prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1").run(f.thread);
    await expect(
      call(f.ctx, threadsWatchOp, userActor(f.other), { threadId: f.thread }),
    ).rejects.toBeInstanceOf(NotFoundError);
    f.ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 2, 0)")
      .run(f.node.id);
    invalidate(f.ctx, "permissions");
    await expect(call(f.ctx, nodesWatchOp, actor, { nodeId: f.node.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(call(f.ctx, threadsWatchOp, actor, { threadId: f.thread })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await call(f.ctx, nodesUnwatchOp, actor, { nodeId: f.node.id });
    await call(f.ctx, nodesUnwatchOp, actor, { nodeId: f.node.id });
    expect((await call(f.ctx, watchesListNodesOp, actor, { limit: 10 })).items).toEqual([]);
  });

  test("following is idempotent and maintains both counters", async () => {
    const f = fixture();
    const actor = userActor(f.owner);
    await expect(call(f.ctx, usersFollowOp, GUEST, { userId: f.other.id })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(call(f.ctx, usersFollowOp, actor, { userId: f.owner.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(call(f.ctx, usersFollowOp, actor, { userId: 999999 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await call(f.ctx, usersFollowOp, actor, { userId: f.other.id })).followerCount).toBe(1);
    expect((await call(f.ctx, usersFollowOp, actor, { userId: f.other.id })).followerCount).toBe(1);
    const events = f.ctx.sqlite
      .prepare<{ target_type: string; target_id: number; payload: string }, []>(
        "SELECT target_type, target_id, payload FROM domain_events WHERE type = 'member.followed'",
      )
      .all();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      target_type: "user",
      target_id: f.other.id,
      payload: JSON.stringify({ followerId: f.owner.id }),
    });
    expect(
      (await call(f.ctx, usersListFollowersOp, actor, { userId: f.other.id, limit: 10 })).items,
    ).toHaveLength(1);
    expect(
      (await call(f.ctx, usersListFollowingOp, actor, { userId: f.owner.id, limit: 10 })).items,
    ).toHaveLength(1);
    await call(f.ctx, usersUnfollowOp, actor, { userId: f.other.id });
    await call(f.ctx, usersUnfollowOp, actor, { userId: f.other.id });
    const rows = f.ctx.sqlite
      .prepare<{ id: number; follower_count: number; following_count: number }, [string]>(
        "SELECT id, follower_count, following_count FROM users WHERE id IN (SELECT value FROM json_each(?1))",
      )
      .all(JSON.stringify([f.owner.id, f.other.id]));
    expect(rows.every((r) => r.follower_count === 0 && r.following_count === 0)).toBe(true);
    await call(f.ctx, usersUnfollowOp, actor, { userId: 999999 });
  });

  test("profile and member permissions gate the social reads and writes", async () => {
    const f = fixture();
    const actor = userActor(f.owner);
    await call(f.ctx, usersFollowOp, actor, { userId: f.other.id });
    await call(f.ctx, usersIgnoreOp, actor, { userId: f.other.id });
    deny(f.ctx, f.owner.id, "profile.view");
    await expect(
      call(f.ctx, usersListFollowersOp, actor, { userId: f.other.id, limit: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      call(f.ctx, usersListFollowingOp, actor, { userId: f.other.id, limit: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    deny(f.ctx, f.owner.id, "member.follow");
    await expect(call(f.ctx, usersFollowOp, actor, { userId: f.other.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    deny(f.ctx, f.owner.id, "member.ignore");
    await expect(call(f.ctx, usersIgnoreOp, actor, { userId: f.other.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await call(f.ctx, usersListIgnoredOp, actor, { limit: 10 })).items).toHaveLength(1);
    await call(f.ctx, usersUnfollowOp, actor, { userId: f.other.id });
    await call(f.ctx, usersUnignoreOp, actor, { userId: f.other.id });
    expect((await call(f.ctx, usersListIgnoredOp, actor, { limit: 10 })).items).toEqual([]);
    deny(f.ctx, f.owner.id, "profile.editOwn");
    await expect(
      call(f.ctx, preferencesUpdateOp, actor, { language: "es" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a hidden watch leaves a short page with a cursor to the next visible watch", async () => {
    const f = fixture();
    const actor = userActor(f.owner);
    await call(f.ctx, threadsWatchOp, actor, { threadId: f.thread });
    const newer = f.ctx.sqlite
      .prepare<{ id: number }, [number, number, string, number]>(
        "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, ?3, 'visible', ?4, ?4, ?2) RETURNING id",
      )
      .get(f.node.id, f.owner.id, "Newer", f.ctx.now())!.id;
    await call(f.ctx, threadsWatchOp, actor, { threadId: newer });
    f.ctx.sqlite.prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1").run(newer);
    const first = await call(f.ctx, watchesListThreadsOp, actor, { limit: 1 });
    expect(first.items).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    const second = await call(f.ctx, watchesListThreadsOp, actor, {
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((item) => item.threadId)).toEqual([f.thread]);
    expect(second.nextCursor).toBeNull();
  });

  test("ignore refuses staff and blocks conversations and wall writes", async () => {
    const f = fixture();
    const owner = { ...userActor(f.owner), clientIp: "127.0.0.1" };
    const other = { ...userActor(f.other), clientIp: "127.0.0.1" };
    await expect(call(f.ctx, usersIgnoreOp, GUEST, { userId: f.other.id })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(call(f.ctx, usersListIgnoredOp, GUEST, { limit: 10 })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(
      call(f.ctx, usersUnfollowOp, GUEST, { userId: f.other.id }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      call(f.ctx, usersUnignoreOp, GUEST, { userId: f.other.id }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(call(f.ctx, usersIgnoreOp, owner, { userId: f.owner.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(call(f.ctx, usersIgnoreOp, owner, { userId: 999999 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(call(f.ctx, usersIgnoreOp, owner, { userId: f.staff.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await call(f.ctx, usersIgnoreOp, owner, { userId: f.other.id });
    expect((await call(f.ctx, usersListIgnoredOp, owner, { limit: 10 })).items[0]?.user.id).toBe(
      f.other.id,
    );
    let spamChecks = 0;
    f.ctx.config.spamChecker = {
      async check() {
        spamChecks++;
        return { spam: false, source: "disabled" };
      },
    };
    await expect(
      call(f.ctx, conversationsCreateOp, other, {
        recipientIds: [f.owner.id],
        title: "Hi",
        body: "Hi",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      call(f.ctx, profilePostsCreateOp, other, { userId: f.owner.id, body: "Hi" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const wall = await call(f.ctx, profilePostsCreateOp, owner, { userId: f.owner.id, body: "Hi" });
    await expect(
      call(f.ctx, profileCommentsCreateOp, other, { profilePostId: wall.id, body: "Hi" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(spamChecks).toBe(1);
    f.ctx.sqlite.prepare("UPDATE users SET group_id = 3 WHERE id = ?1").run(f.other.id);
    const promoted = { ...userActor({ ...f.other, groupId: 3 }), clientIp: "127.0.0.1" };
    await call(f.ctx, conversationsCreateOp, promoted, {
      recipientIds: [f.owner.id],
      title: "Allowed",
      body: "Hi",
    });
    await call(f.ctx, profilePostsCreateOp, promoted, { userId: f.owner.id, body: "Hi" });
    await call(f.ctx, profileCommentsCreateOp, promoted, { profilePostId: wall.id, body: "Hi" });
    await call(f.ctx, usersUnignoreOp, owner, { userId: f.other.id });
    await call(f.ctx, usersUnignoreOp, owner, { userId: f.other.id });
    await call(f.ctx, usersUnignoreOp, owner, { userId: 999999 });
    expect((await call(f.ctx, usersListIgnoredOp, owner, { limit: 10 })).items).toEqual([]);
  });

  test("a currently banned member can be ignored", async () => {
    const f = fixture();
    f.ctx.sqlite
      .prepare("UPDATE users SET banned_until = ?1 WHERE id = ?2")
      .run(f.ctx.now() + 60_000, f.other.id);
    await call(f.ctx, usersIgnoreOp, userActor(f.owner), { userId: f.other.id });
    expect(
      (await call(f.ctx, usersListIgnoredOp, userActor(f.owner), { limit: 10 })).items[0]?.user.id,
    ).toBe(f.other.id);
  });

  test("preferences validate language and event auto-watch respects modes", async () => {
    const f = fixture();
    const actor = userActor(f.owner);
    await expect(call(f.ctx, preferencesGetOp, GUEST, {})).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(
      call(f.ctx, preferencesUpdateOp, actor, { language: "fr" }),
    ).rejects.toBeInstanceOf(ValidationError);
    registerSocialJobs(f.ctx);
    await call(f.ctx, preferencesUpdateOp, actor, {
      watchOnCreate: "none",
      watchOnReply: "watch_email",
      language: "es",
    });
    expect((await call(f.ctx, preferencesGetOp, actor, {})).language).toBe("es");
    writeTx(f.ctx, () =>
      publishEvent(f.ctx, { type: "content.created", targetType: "thread", targetId: f.thread }),
    );
    await dispatchEvents(f.ctx);
    expect((await call(f.ctx, watchesListThreadsOp, actor, { limit: 10 })).items).toEqual([]);
    writeTx(f.ctx, () =>
      publishEvent(f.ctx, { type: "content.created", targetType: "post", targetId: f.post }),
    );
    await dispatchEvents(f.ctx);
    expect((await call(f.ctx, watchesListThreadsOp, actor, { limit: 10 })).items).toEqual([]);
    const reply = f.ctx.sqlite
      .prepare<{ id: number }, [number, number, number]>(
        "INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, 1, ?3) RETURNING id",
      )
      .get(f.thread, f.owner.id, f.ctx.now())!.id;
    writeTx(f.ctx, () =>
      publishEvent(f.ctx, { type: "content.created", targetType: "post", targetId: reply }),
    );
    await dispatchEvents(f.ctx);
    expect((await call(f.ctx, watchesListThreadsOp, actor, { limit: 10 })).items[0]?.email).toBe(
      true,
    );
    f.ctx.sqlite
      .prepare("UPDATE thread_watches SET email = 0 WHERE user_id = ?1 AND thread_id = ?2")
      .run(f.owner.id, f.thread);
    writeTx(f.ctx, () =>
      publishEvent(f.ctx, { type: "content.created", targetType: "post", targetId: reply }),
    );
    await dispatchEvents(f.ctx);
    expect((await call(f.ctx, watchesListThreadsOp, actor, { limit: 10 })).items[0]?.email).toBe(
      true,
    );
    f.ctx.sqlite.prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1").run(f.thread);
    const moderatedReply = f.ctx.sqlite
      .prepare<{ id: number }, [number, number, number]>(
        "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, 2, 'moderated', ?3) RETURNING id",
      )
      .get(f.thread, f.other.id, f.ctx.now())!.id;
    writeTx(f.ctx, () => {
      publishEvent(f.ctx, {
        type: "content.created",
        targetType: "post",
        targetId: moderatedReply,
      });
      publishEvent(f.ctx, { type: "content.created", targetType: "post", targetId: 999999 });
    });
    await dispatchEvents(f.ctx);
    expect(
      (await call(f.ctx, watchesListThreadsOp, userActor(f.other), { limit: 10 })).items,
    ).toEqual([]);
    f.ctx.sqlite.prepare("UPDATE threads SET state = 'visible' WHERE id = ?1").run(f.thread);
    await call(f.ctx, threadsUnwatchOp, actor, { threadId: f.thread });
    const visibleThreadModeratedReply = f.ctx.sqlite
      .prepare<{ id: number }, [number, number, number]>(
        "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, 3, 'moderated', ?3) RETURNING id",
      )
      .get(f.thread, f.owner.id, f.ctx.now())!.id;
    writeTx(f.ctx, () =>
      publishEvent(f.ctx, {
        type: "content.created",
        targetType: "post",
        targetId: visibleThreadModeratedReply,
      }),
    );
    await dispatchEvents(f.ctx);
    expect((await call(f.ctx, watchesListThreadsOp, actor, { limit: 10 })).items[0]?.email).toBe(
      true,
    );
    for (const [mode, email] of [
      ["watch", false],
      ["watch_email", true],
    ] as const) {
      await call(f.ctx, preferencesUpdateOp, actor, { watchOnCreate: mode });
      const nextThread = f.ctx.sqlite
        .prepare<{ id: number }, [number, number, string, number]>(
          "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, ?3, ?4, ?4, ?2) RETURNING id",
        )
        .get(f.node.id, f.owner.id, mode, f.ctx.now())!.id;
      writeTx(f.ctx, () =>
        publishEvent(f.ctx, {
          type: "content.created",
          targetType: "thread",
          targetId: nextThread,
        }),
      );
      await dispatchEvents(f.ctx);
      expect((await call(f.ctx, watchesListThreadsOp, actor, { limit: 10 })).items[0]?.email).toBe(
        email,
      );
    }
  });

  test("keyset listings use indexes", () => {
    const f = fixture();
    for (const sql of Object.values(watchSql))
      expectNoTableScan(f.ctx, sql, [f.owner.id, 999999, 21]);
  });
});
