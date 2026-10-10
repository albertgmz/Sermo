import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import {
  existingSql,
  listSql,
  operations,
  reactionsListOp,
  reactionsRemoveOp,
  reactionsSetOp,
  reactionTypesCreateOp,
  reactionTypesListOp,
  reactionTypesUpdateOp,
} from "./index";

function fixture() {
  const ctx = createTestContext();
  const author = insertUser(ctx);
  const reactor = insertUser(ctx);
  const other = insertUser(ctx);
  const mod = insertUser(ctx, { groupId: 3 });
  const admin = insertUser(ctx, { groupId: 4 });
  const node = insertNode(ctx, {});
  const now = ctx.now();
  const thread = ctx.sqlite
    .prepare<{ id: number }, [number, number, string, number, number]>(
      "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, ?3, ?4, ?5, ?2) RETURNING id",
    )
    .get(node.id, author.id, "Thread", now, now)!.id;
  const post = ctx.sqlite
    .prepare<{ id: number }, [number, number, number, number]>(
      "INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id",
    )
    .get(thread, author.id, 0, now)!.id;
  ctx.sqlite
    .prepare("UPDATE threads SET first_post_id = ?1, last_post_id = ?1 WHERE id = ?2")
    .run(post, thread);
  const profile = ctx.sqlite
    .prepare<{ id: number }, [number, number, number, string, string]>(
      "INSERT INTO profile_posts (profile_user_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id",
    )
    .get(author.id, author.id, now, "body", "body")!.id;
  const comment = ctx.sqlite
    .prepare<{ id: number }, [number, number, number, string, string]>(
      "INSERT INTO profile_post_comments (profile_post_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id",
    )
    .get(profile, author.id, now, "body", "body")!.id;
  const conversation = ctx.sqlite
    .prepare<{ id: number }, [string, number, number, number]>(
      "INSERT INTO conversations (title, user_id, created_at, last_message_at, last_message_user_id) VALUES (?1, ?2, ?3, ?3, ?4) RETURNING id",
    )
    .get("Conversation", author.id, now, author.id)!.id;
  for (const user of [author, reactor, mod]) {
    ctx.sqlite
      .prepare(
        "INSERT INTO conversation_participants (conversation_id, user_id, joined_at, last_message_at) VALUES (?1, ?2, ?3, ?3)",
      )
      .run(conversation, user.id, now);
  }
  const message = ctx.sqlite
    .prepare<{ id: number }, [number, number, number, string, string]>(
      "INSERT INTO conversation_messages (conversation_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id",
    )
    .get(conversation, author.id, now, "body", "body")!.id;
  return {
    ctx,
    author,
    reactor,
    other,
    mod,
    admin,
    node,
    thread,
    post,
    profile,
    comment,
    conversation,
    message,
  };
}
const refs = [
  { contentType: "post", key: "post", table: "posts" },
  { contentType: "profile_post", key: "profile", table: "profile_posts" },
  { contentType: "profile_post_comment", key: "comment", table: "profile_post_comments" },
  { contentType: "conversation_message", key: "message", table: "conversation_messages" },
] as const;
async function createType(f: ReturnType<typeof fixture>, score: number, position = 0) {
  return execute(f.ctx, reactionTypesCreateOp, userActor(f.admin), {
    title: `Type ${score}`,
    emoji: "X",
    score,
    position,
  });
}
function checkCounters(f: ReturnType<typeof fixture>, ref: (typeof refs)[number]) {
  const id = f[ref.key];
  const rows = f.ctx.sqlite
    .prepare<{ reaction_type_id: number; score: number }, [string, number]>(
      "SELECT reaction_type_id, score FROM reactions WHERE content_type = ?1 AND content_id = ?2",
    )
    .all(ref.contentType, id);
  const expected: Record<string, number> = {};
  for (const row of rows)
    expected[row.reaction_type_id] = (expected[row.reaction_type_id] ?? 0) + 1;
  const actual = f.ctx.sqlite
    .prepare<{ reaction_counts: string }, [number]>(
      `SELECT reaction_counts FROM ${ref.table} WHERE id = ?1`,
    )
    .get(id)!;
  expect(JSON.parse(actual.reaction_counts)).toEqual(expected);
  const score = f.ctx.sqlite
    .prepare<{ reaction_score: number }, [number]>("SELECT reaction_score FROM users WHERE id = ?1")
    .get(f.author.id)!.reaction_score;
  expect(score).toBe(rows.reduce((sum, row) => sum + row.score, 0));
}

describe("reactions", () => {
  test("a never entry overrides an allowing secondary group", async () => {
    const f = fixture();
    const type = await createType(f, 1);
    const target = { contentType: "post" as const, contentId: f.post };
    const actor = userActor(f.reactor);
    const addGroup = (title: string, value: number) => {
      const groupId = f.ctx.sqlite
        .prepare<{ id: number }, [string]>(
          "INSERT INTO groups (title, rank) VALUES (?1, 10) RETURNING id",
        )
        .get(title)!.id;
      f.ctx.sqlite
        .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
        .run(f.reactor.id, groupId);
      f.ctx.sqlite
        .prepare(
          "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = 'reaction.react'), 0, ?1, 0, ?2)",
        )
        .run(groupId, value);
      return groupId;
    };
    addGroup("Allow reactions", 1);
    const denyingGroup = addGroup("Deny reactions", -1);
    f.ctx.sqlite
      .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
      .run();
    await expect(
      execute(f.ctx, reactionsSetOp, actor, { ...target, reactionTypeId: type.id }),
    ).rejects.toThrow(ForbiddenError);
    await expect(execute(f.ctx, reactionsRemoveOp, actor, target)).rejects.toThrow(ForbiddenError);
    f.ctx.sqlite
      .prepare("DELETE FROM user_groups WHERE user_id = ?1 AND group_id = ?2")
      .run(f.reactor.id, denyingGroup);
    f.ctx.sqlite
      .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
      .run();
    expect(
      (await execute(f.ctx, reactionsSetOp, actor, { ...target, reactionTypeId: type.id })).mine,
    ).toBe(type.id);
    expect((await execute(f.ctx, reactionsRemoveOp, actor, target)).mine).toBeNull();
  });
  test("reaction type management accepts a specific custom permission", async () => {
    const f = fixture();
    const input = { title: "Custom", emoji: "C", score: 1, position: 10 };
    const actor = userActor(f.reactor);
    await expect(execute(f.ctx, reactionTypesCreateOp, actor, input)).rejects.toThrow(
      ForbiddenError,
    );
    const groupId = f.ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Reaction managers', 10) RETURNING id",
      )
      .get()!.id;
    f.ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(f.reactor.id, groupId);
    f.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = 'admin.reactionTypes'), 0, ?1, 0, 1)",
      )
      .run(groupId);
    f.ctx.sqlite
      .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
      .run();
    const type = await execute(f.ctx, reactionTypesCreateOp, actor, input);
    expect(type.title).toBe("Custom");
    expect(
      (
        await execute(f.ctx, reactionTypesUpdateOp, actor, {
          reactionTypeId: type.id,
          title: "Updated",
        })
      ).title,
    ).toBe("Updated");
  });
  test("registers all contracts and manages ordered cached types", async () => {
    const f = fixture();
    expect(operations.map((op) => op.name).sort()).toEqual(
      [
        "reactionTypes.list",
        "reactionTypes.create",
        "reactionTypes.update",
        "reactions.set",
        "reactions.remove",
        "reactions.list",
      ].sort(),
    );
    const initial = (await execute(f.ctx, reactionTypesListOp, GUEST, {})).items;
    const first = await createType(f, 1, 10);
    expect((await execute(f.ctx, reactionTypesListOp, GUEST, {})).items).toHaveLength(
      initial.length + 1,
    );
    const second = await createType(f, 2, 0);
    const ordered = (await execute(f.ctx, reactionTypesListOp, GUEST, {})).items;
    expect(ordered[0]?.id).toBe(second.id);
    expect(ordered.findIndex((type) => type.id === first.id)).toBeGreaterThan(0);
    await execute(f.ctx, reactionTypesUpdateOp, userActor(f.admin), {
      reactionTypeId: first.id,
      position: -1,
      isActive: false,
    });
    expect((await execute(f.ctx, reactionTypesListOp, GUEST, {})).items[0]?.isActive).toBe(false);
    await expect(
      execute(f.ctx, reactionTypesCreateOp, GUEST, { title: "A", emoji: "A" }),
    ).rejects.toThrow(UnauthenticatedError);
    await expect(
      execute(f.ctx, reactionTypesCreateOp, userActor(f.reactor), { title: "A", emoji: "A" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(f.ctx, reactionTypesUpdateOp, GUEST, { reactionTypeId: first.id, title: "A" }),
    ).rejects.toThrow(UnauthenticatedError);
    await expect(
      execute(f.ctx, reactionTypesUpdateOp, userActor(f.reactor), {
        reactionTypeId: first.id,
        title: "A",
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(f.ctx, reactionTypesUpdateOp, userActor(f.admin), {
        reactionTypeId: 99999,
        title: "A",
      }),
    ).rejects.toThrow(NotFoundError);
  });
  for (const ref of refs) {
    test(`${ref.contentType}: set, change, no-op, remove and stored scores`, async () => {
      const f = fixture();
      const one = await createType(f, 3);
      const two = await createType(f, 5);
      const target = { contentType: ref.contentType, contentId: f[ref.key] };
      const actor = userActor(f.reactor);
      expect(
        (await execute(f.ctx, reactionsSetOp, actor, { ...target, reactionTypeId: one.id })).mine,
      ).toBe(one.id);
      checkCounters(f, ref);
      await execute(f.ctx, reactionTypesUpdateOp, userActor(f.admin), {
        reactionTypeId: one.id,
        score: 9,
      });
      const storedBefore = f.ctx.sqlite
        .prepare<{ id: number; score: number; created_at: number }, [string, number, number]>(
          "SELECT id, score, created_at FROM reactions WHERE content_type = ?1 AND content_id = ?2 AND user_id = ?3",
        )
        .get(ref.contentType, f[ref.key], f.reactor.id)!;
      const authorScoreBefore = f.ctx.sqlite
        .prepare<{ reaction_score: number }, [number]>(
          "SELECT reaction_score FROM users WHERE id = ?1",
        )
        .get(f.author.id)!.reaction_score;
      await execute(f.ctx, reactionsSetOp, actor, { ...target, reactionTypeId: one.id });
      expect(
        f.ctx.sqlite
          .prepare<{ id: number; score: number; created_at: number }, [string, number, number]>(
            "SELECT id, score, created_at FROM reactions WHERE content_type = ?1 AND content_id = ?2 AND user_id = ?3",
          )
          .get(ref.contentType, f[ref.key], f.reactor.id),
      ).toEqual(storedBefore);
      expect(
        f.ctx.sqlite
          .prepare<{ reaction_score: number }, [number]>(
            "SELECT reaction_score FROM users WHERE id = ?1",
          )
          .get(f.author.id)?.reaction_score,
      ).toBe(authorScoreBefore);
      checkCounters(f, ref);
      expect(
        (await execute(f.ctx, reactionsSetOp, actor, { ...target, reactionTypeId: two.id })).counts,
      ).toEqual({ [two.id]: 1 });
      checkCounters(f, ref);
      await execute(f.ctx, reactionTypesUpdateOp, userActor(f.admin), {
        reactionTypeId: two.id,
        score: -2,
      });
      expect((await execute(f.ctx, reactionsRemoveOp, actor, target)).total).toBe(0);
      checkCounters(f, ref);
      expect((await execute(f.ctx, reactionsRemoveOp, actor, target)).mine).toBeNull();
      checkCounters(f, ref);
      expect(
        (await execute(f.ctx, reactionsSetOp, actor, { ...target, reactionTypeId: one.id })).total,
      ).toBe(1);
      checkCounters(f, ref);
      await execute(f.ctx, reactionsRemoveOp, actor, target);
      checkCounters(f, ref);
      await expect(
        execute(f.ctx, reactionsSetOp, GUEST, { ...target, reactionTypeId: one.id }),
      ).rejects.toThrow(UnauthenticatedError);
      await expect(execute(f.ctx, reactionsRemoveOp, GUEST, target)).rejects.toThrow(
        UnauthenticatedError,
      );
      await expect(
        execute(f.ctx, reactionsSetOp, userActor(f.author), { ...target, reactionTypeId: one.id }),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        execute(f.ctx, reactionsSetOp, actor, { ...target, reactionTypeId: 99999 }),
      ).rejects.toThrow(ValidationError);
      await execute(f.ctx, reactionTypesUpdateOp, userActor(f.admin), {
        reactionTypeId: one.id,
        isActive: false,
      });
      await expect(
        execute(f.ctx, reactionsSetOp, actor, { ...target, reactionTypeId: one.id }),
      ).rejects.toThrow(ValidationError);
    });
    test(`${ref.contentType}: paginates by user id`, async () => {
      const f = fixture();
      const type = await createType(f, 1);
      const target = { contentType: ref.contentType, contentId: f[ref.key] };
      const users = [
        f.reactor,
        f.mod,
        f.admin,
        ...Array.from({ length: 4 }, () => insertUser(f.ctx)),
      ];
      if (ref.contentType === "conversation_message") {
        const addParticipant = f.ctx.sqlite.prepare(
          "INSERT INTO conversation_participants (conversation_id, user_id, joined_at, last_message_at) VALUES (?1, ?2, ?3, ?3)",
        );
        for (const user of users.slice(2)) addParticipant.run(f.conversation, user.id, f.ctx.now());
      }
      for (const user of users)
        await execute(f.ctx, reactionsSetOp, userActor(user), {
          ...target,
          reactionTypeId: type.id,
        });
      const ids: number[] = [];
      const pageSizes: number[] = [];
      let cursor: string | undefined;
      do {
        const page = await execute(
          f.ctx,
          reactionsListOp,
          ref.contentType === "conversation_message" ? userActor(f.reactor) : GUEST,
          {
            ...target,
            limit: 2,
            ...(cursor ? { cursor } : {}),
          },
        );
        pageSizes.push(page.items.length);
        ids.push(...page.items.map((item) => item.user.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(pageSizes).toEqual([2, 2, 2, 1]);
      expect(ids).toEqual(users.map((user) => user.id).sort((a, b) => a - b));
      expectNoTableScan(f.ctx, existingSql, [ref.contentType, f[ref.key], f.reactor.id]);
      expectNoTableScan(f.ctx, listSql, [ref.contentType, f[ref.key], 0, 2]);
    });
    test(`${ref.contentType}: removing one reaction retains the other type`, async () => {
      const f = fixture();
      const one = await createType(f, 1);
      const two = await createType(f, 2);
      const target = { contentType: ref.contentType, contentId: f[ref.key] };
      await execute(f.ctx, reactionsSetOp, userActor(f.reactor), {
        ...target,
        reactionTypeId: one.id,
      });
      await execute(f.ctx, reactionsSetOp, userActor(f.mod), { ...target, reactionTypeId: two.id });
      expect(
        (await execute(f.ctx, reactionsRemoveOp, userActor(f.reactor), target)).counts,
      ).toEqual({
        [two.id]: 1,
      });
      checkCounters(f, ref);
    });
  }
  test("rejects disabled groups and hidden content", async () => {
    const f = fixture();
    const type = await createType(f, 1);
    const actor = userActor(f.reactor);
    await execute(f.ctx, reactionsSetOp, actor, {
      contentType: "post",
      contentId: f.post,
      reactionTypeId: type.id,
    });
    f.ctx.sqlite.prepare("UPDATE groups SET can_react = 0 WHERE id = 2").run();
    f.ctx.sqlite
      .prepare(
        "INSERT INTO cache_versions (key, version) VALUES ('permissions', 1) ON CONFLICT (key) DO UPDATE SET version = version + 1",
      )
      .run();
    await expect(
      execute(f.ctx, reactionsSetOp, actor, {
        contentType: "post",
        contentId: f.post,
        reactionTypeId: type.id,
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(f.ctx, reactionsRemoveOp, actor, { contentType: "post", contentId: f.post }),
    ).rejects.toThrow(ForbiddenError);
    f.ctx.sqlite.prepare("UPDATE groups SET can_react = 1 WHERE id = 2").run();
    f.ctx.sqlite
      .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
      .run();
    f.ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(f.post);
    await expect(
      execute(f.ctx, reactionsSetOp, actor, {
        contentType: "post",
        contentId: f.post,
        reactionTypeId: type.id,
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(f.ctx, reactionsSetOp, userActor(f.mod), {
        contentType: "post",
        contentId: f.post,
        reactionTypeId: type.id,
      }),
    ).rejects.toThrow(ForbiddenError);
    f.ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(f.post);
    await expect(
      execute(f.ctx, reactionsListOp, actor, { contentType: "post", contentId: f.post }),
    ).rejects.toThrow(NotFoundError);
    f.ctx.sqlite
      .prepare("UPDATE profile_posts SET state = 'moderated' WHERE id = ?1")
      .run(f.profile);
    await expect(
      execute(f.ctx, reactionsSetOp, actor, {
        contentType: "profile_post",
        contentId: f.profile,
        reactionTypeId: type.id,
      }),
    ).rejects.toThrow(NotFoundError);
    f.ctx.sqlite
      .prepare(
        "UPDATE conversation_participants SET state = 'left' WHERE conversation_id = ?1 AND user_id = ?2",
      )
      .run(f.conversation, f.reactor.id);
    await expect(
      execute(f.ctx, reactionsSetOp, actor, {
        contentType: "conversation_message",
        contentId: f.message,
        reactionTypeId: type.id,
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(f.ctx, reactionsListOp, userActor(f.other), {
        contentType: "conversation_message",
        contentId: f.message,
      }),
    ).rejects.toThrow(NotFoundError);
  });
  test("Guest group cannot react even with its flag forced on", async () => {
    const f = fixture();
    const type = await createType(f, 1);
    f.ctx.sqlite.prepare("UPDATE groups SET can_react = 1 WHERE id = 1").run();
    f.ctx.sqlite
      .prepare(
        "INSERT INTO cache_versions (key, version) VALUES ('permissions', 1) ON CONFLICT (key) DO UPDATE SET version = version + 1",
      )
      .run();
    await expect(
      execute(f.ctx, reactionsSetOp, GUEST, {
        contentType: "post",
        contentId: f.post,
        reactionTypeId: type.id,
      }),
    ).rejects.toThrow(UnauthenticatedError);
    await expect(
      execute(f.ctx, reactionsRemoveOp, GUEST, { contentType: "post", contentId: f.post }),
    ).rejects.toThrow(UnauthenticatedError);
  });
  test("hidden threads, profile permissions and conversation membership", async () => {
    const f = fixture();
    const type = await createType(f, 1);
    const actor = userActor(f.reactor);
    for (const state of ["moderated", "deleted"]) {
      f.ctx.sqlite.prepare("UPDATE threads SET state = ?1 WHERE id = ?2").run(state, f.thread);
      await expect(
        execute(f.ctx, reactionsSetOp, actor, {
          contentType: "post",
          contentId: f.post,
          reactionTypeId: type.id,
        }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        execute(f.ctx, reactionsSetOp, userActor(f.mod), {
          contentType: "post",
          contentId: f.post,
          reactionTypeId: type.id,
        }),
      ).rejects.toThrow(ForbiddenError);
    }
    f.ctx.sqlite.prepare("UPDATE groups SET can_view_profiles = 0 WHERE id = 2").run();
    f.ctx.sqlite
      .prepare(
        "INSERT INTO cache_versions (key, version) VALUES ('permissions', 1) ON CONFLICT (key) DO UPDATE SET version = version + 1",
      )
      .run();
    for (const target of [
      { contentType: "profile_post", contentId: f.profile },
      { contentType: "profile_post_comment", contentId: f.comment },
    ] as const) {
      await expect(
        execute(f.ctx, reactionsSetOp, actor, { ...target, reactionTypeId: type.id }),
      ).rejects.toThrow(NotFoundError);
    }
    await expect(
      execute(f.ctx, reactionsSetOp, userActor(f.other), {
        contentType: "conversation_message",
        contentId: f.message,
        reactionTypeId: type.id,
      }),
    ).rejects.toThrow(NotFoundError);
  });
  test("hidden nodes, parents and messages enforce visibility", async () => {
    const f = fixture();
    const type = await createType(f, 1);
    const actor = userActor(f.reactor);
    f.ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 2, 0)")
      .run(f.node.id);
    f.ctx.sqlite
      .prepare(
        "INSERT INTO cache_versions (key, version) VALUES ('permissions', 1) ON CONFLICT (key) DO UPDATE SET version = version + 1",
      )
      .run();
    await expect(
      execute(f.ctx, reactionsSetOp, actor, {
        contentType: "post",
        contentId: f.post,
        reactionTypeId: type.id,
      }),
    ).rejects.toThrow(NotFoundError);
    f.ctx.sqlite.prepare("DELETE FROM node_permissions WHERE node_id = ?1").run(f.node.id);
    f.ctx.sqlite
      .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
      .run();
    f.ctx.sqlite.prepare("UPDATE profile_posts SET state = 'deleted' WHERE id = ?1").run(f.profile);
    await expect(
      execute(f.ctx, reactionsSetOp, actor, {
        contentType: "profile_post_comment",
        contentId: f.comment,
        reactionTypeId: type.id,
      }),
    ).rejects.toThrow(NotFoundError);
    f.ctx.sqlite.prepare("UPDATE profile_posts SET state = 'visible' WHERE id = ?1").run(f.profile);
    f.ctx.sqlite
      .prepare("UPDATE profile_post_comments SET state = 'moderated' WHERE id = ?1")
      .run(f.comment);
    await expect(
      execute(f.ctx, reactionsSetOp, actor, {
        contentType: "profile_post_comment",
        contentId: f.comment,
        reactionTypeId: type.id,
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(f.ctx, reactionsSetOp, userActor(f.mod), {
        contentType: "profile_post_comment",
        contentId: f.comment,
        reactionTypeId: type.id,
      }),
    ).rejects.toThrow(ForbiddenError);
    f.ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'moderated' WHERE id = ?1")
      .run(f.message);
    await expect(
      execute(f.ctx, reactionsSetOp, actor, {
        contentType: "conversation_message",
        contentId: f.message,
        reactionTypeId: type.id,
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});
