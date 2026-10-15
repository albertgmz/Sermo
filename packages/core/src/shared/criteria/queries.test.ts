import { describe, expect, test } from "bun:test";
import type { Ctx } from "../../context";
import { ValidationError } from "../../errors";
import { createTestContext, expectNoTableScan, insertNode, insertUser } from "../../testing";
import {
  assertRule,
  type Condition,
  criteriaMeasures,
  criterionDefinitions,
  evaluate,
  loadFacts,
  measureSlots,
  type Rule,
} from "../criteria";

/**
 * Every measured criterion against real rows: what its statement counts, who it holds for, and
 * the edge. `member` has the rows the condition asks for, `other` has none of them.
 */

const rule = (...conditions: Condition[]): Rule => ({ match: "all", conditions });

/** Whether a rule holds for each member, loaded the way a consumer loads them. */
function holdsFor(ctx: Ctx, memberIds: number[], condition: Condition): boolean[] {
  const only = rule(condition);
  const facts = loadFacts(ctx, memberIds, [only]);
  return memberIds.map((id) => evaluate(only, facts.get(id)!));
}

function insertRow(ctx: Ctx, sql: string, ...params: (string | number | null)[]): number {
  return ctx.sqlite
    .prepare<{ id: number }, (string | number | null)[]>(`${sql} RETURNING id`)
    .get(...params)!.id;
}

function thread(ctx: Ctx, userId: number, nodeId: number, replies = 0, state = "visible") {
  return insertRow(
    ctx,
    "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id, reply_count) VALUES (?1, ?2, 'T', ?3, 1, 1, ?2, ?4)",
    nodeId,
    userId,
    state,
    replies,
  );
}

let position = 0;
function post(ctx: Ctx, threadId: number, userId: number, state = "visible") {
  position += 1;
  return insertRow(
    ctx,
    "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, ?4, 1)",
    threadId,
    userId,
    position,
    state,
  );
}

function world() {
  const ctx = createTestContext();
  const member = insertUser(ctx).id;
  const other = insertUser(ctx).id;
  const node = insertNode(ctx, {}).id;
  return { ctx, member, other, node };
}

describe("content criteria", () => {
  test("posts_in_threads counts visible posts per thread, in each, one and all mode", () => {
    const { ctx, member, other, node } = world();
    const [a, b, c] = [
      thread(ctx, other, node),
      thread(ctx, other, node),
      thread(ctx, other, node),
    ];
    for (let n = 0; n < 3; n++) post(ctx, a, member);
    post(ctx, b, member);
    post(ctx, b, member, "deleted");
    post(ctx, b, member, "moderated");
    post(ctx, a, other);
    const asks = (mode: "each" | "one" | "all", value: number, ids = [a, b]) =>
      holdsFor(ctx, [member, other], { criterion: "posts_in_threads", ids, value, mode });
    expect(asks("each", 1)).toEqual([true, false]);
    expect(asks("each", 3)).toEqual([false, false]);
    expect(asks("one", 3)).toEqual([true, false]);
    expect(asks("one", 4)).toEqual([false, false]);
    expect(asks("all", 4)).toEqual([true, false]);
    expect(asks("all", 5)).toEqual([false, false]);
    // A thread the member never posted in.
    expect(asks("each", 1, [a, b, c])).toEqual([false, false]);
    expect(asks("each", 3, [a])).toEqual([true, false]);
  });

  test("replies_received sums the replies of the member's visible threads", () => {
    const { ctx, member, other, node } = world();
    thread(ctx, member, node, 4);
    thread(ctx, member, node, 6);
    thread(ctx, member, node, 50, "deleted");
    thread(ctx, other, node, 99);
    const asks = (value: number) =>
      holdsFor(ctx, [member, other], { criterion: "replies_received", value });
    expect(asks(10)).toEqual([true, true]);
    expect(asks(11)).toEqual([false, true]);
    expect(holdsFor(ctx, [member], { criterion: "busiest_thread_replies", value: 6 })).toEqual([
      true,
    ]);
    expect(holdsFor(ctx, [member], { criterion: "busiest_thread_replies", value: 7 })).toEqual([
      false,
    ]);
  });

  test("replies_received and busiest_thread_replies of a member with no thread", () => {
    const { ctx, member } = world();
    expect(holdsFor(ctx, [member], { criterion: "replies_received", value: 1 })).toEqual([false]);
    expect(holdsFor(ctx, [member], { criterion: "busiest_thread_replies", value: 0 })).toEqual([
      true,
    ]);
  });

  test("profile posts and comments written count the visible ones the member wrote", () => {
    const { ctx, member, other } = world();
    const wall = (author: number, state = "visible") =>
      insertRow(
        ctx,
        "INSERT INTO profile_posts (profile_user_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 1, 'b', 'b')",
        other,
        author,
        state,
      );
    const first = wall(member);
    wall(member);
    wall(member, "deleted");
    wall(other);
    const comment = (author: number, state = "visible") =>
      insertRow(
        ctx,
        "INSERT INTO profile_post_comments (profile_post_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 1, 'b', 'b')",
        first,
        author,
        state,
      );
    comment(member);
    comment(member, "moderated");
    comment(other);
    const posts = (value: number) =>
      holdsFor(ctx, [member, other], { criterion: "profile_posts_written", value });
    expect(posts(2)).toEqual([true, false]);
    expect(posts(3)).toEqual([false, false]);
    expect(posts(1)).toEqual([true, true]);
    const comments = (value: number) =>
      holdsFor(ctx, [member, other], { criterion: "profile_comments_written", value });
    expect(comments(1)).toEqual([true, true]);
    expect(comments(2)).toEqual([false, false]);
  });

  test("attachments_uploaded counts the member's attached attachment files", () => {
    const { ctx, member, other } = world();
    const file = (uploader: number, purpose: string, visibility: string, deleted: number | null) =>
      insertRow(
        ctx,
        "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at, deleted_at) VALUES ('d', ?1, 1, 'text/plain', 'x', ?2, ?3, ?4, 1, ?5)",
        `k${Math.random()}`,
        uploader,
        purpose,
        visibility,
        deleted,
      );
    file(member, "attachment", "public", null);
    file(member, "attachment", "private", null);
    file(member, "attachment", "unattached", null);
    file(member, "attachment", "public", 5);
    file(member, "avatar", "public", null);
    file(other, "attachment", "public", null);
    const asks = (value: number) =>
      holdsFor(ctx, [member, other], { criterion: "attachments_uploaded", value });
    expect(asks(2)).toEqual([true, false]);
    expect(asks(3)).toEqual([false, false]);
  });

  test("bookmarks, watched forums and watched threads count the member's rows", () => {
    const { ctx, member, other, node } = world();
    const second = insertNode(ctx, {}).id;
    const t1 = thread(ctx, other, node);
    const t2 = thread(ctx, other, node);
    for (const id of [t1, t2])
      insertRow(
        ctx,
        "INSERT INTO bookmarks (user_id, content_type, content_id, created_at) VALUES (?1, 'thread', ?2, 1)",
        member,
        id,
      );
    for (const id of [node, second])
      insertRow(
        ctx,
        "INSERT INTO node_watches (user_id, node_id, mode, created_at) VALUES (?1, ?2, 'threads', 1)",
        member,
        id,
      );
    insertRow(
      ctx,
      "INSERT INTO thread_watches (user_id, thread_id, created_at) VALUES (?1, ?2, 1)",
      member,
      t1,
    );
    const asks = (criterion: string, value: number) =>
      holdsFor(ctx, [member, other], { criterion, value });
    expect(asks("bookmarks_at_least", 2)).toEqual([true, false]);
    expect(asks("bookmarks_at_least", 3)).toEqual([false, false]);
    expect(asks("watching_forums_at_least", 2)).toEqual([true, false]);
    expect(asks("watching_forums_at_least", 3)).toEqual([false, false]);
    expect(asks("watching_threads_at_least", 1)).toEqual([true, false]);
    expect(asks("watching_threads_at_least", 2)).toEqual([false, false]);
  });
});

describe("measured criteria", () => {
  test("every measured criterion's statement is answered from indexes", () => {
    const ctx = createTestContext();
    expect(criteriaMeasures.length).toBeGreaterThan(0);
    for (const { id, sql } of criteriaMeasures) {
      const params = measureSlots({ criterion: id, ids: [1] }, "[1,2]", ctx.now(), sql);
      expectNoTableScan(ctx, sql, params);
    }
  });

  test("a page of members costs one query per measured condition, not one per member", () => {
    const statements = (members: number) => {
      const ctx = createTestContext();
      const ids = Array.from({ length: members }, () => insertUser(ctx).id);
      const seen: string[] = [];
      const original = ctx.sqlite.prepare.bind(ctx.sqlite);
      (ctx.sqlite as { prepare: unknown }).prepare = (sql: string) => {
        seen.push(sql);
        return original(sql);
      };
      loadFacts(ctx, ids, [
        rule(
          { criterion: "posts_in_threads", ids: [1, 2], value: 1 },
          { criterion: "replies_received", value: 1 },
          { criterion: "bookmarks_at_least", value: 1 },
          // The same measurement under another threshold shares its query.
          { criterion: "replies_received", value: 9 },
        ),
      ]);
      return seen.length;
    };
    expect(statements(1)).toBe(3);
    expect(statements(40)).toBe(3);
  });
});

describe("assertRule: the new criteria", () => {
  const ctx = createTestContext();
  const refuses = (condition: Condition) =>
    expect(() => assertRule(ctx, rule(condition), "background")).toThrow(ValidationError);

  test("a measured criterion takes the number and list it declares, and no more", () => {
    refuses({ criterion: "replies_received" });
    refuses({ criterion: "replies_received", value: 1, ids: [1] });
    refuses({ criterion: "replies_received", value: 1, days: 3 });
    refuses({ criterion: "replies_received", value: 1, mode: "one" });
    refuses({ criterion: "posts_in_threads", value: 1 });
    refuses({ criterion: "posts_in_threads", ids: [1] });
    refuses({ criterion: "posts_in_threads", ids: [1], value: 1, mode: "none" });
    refuses({ criterion: "posts_in_threads", ids: [1], value: 1, days: 3 });
  });

  test("a thread that does not exist is refused, one that does is accepted", () => {
    const { ctx: seeded, member, node } = world();
    const real = thread(seeded, member, node);
    assertRule(
      seeded,
      rule({ criterion: "posts_in_threads", ids: [real], value: 2, mode: "all" }),
      "background",
    );
    expect(() =>
      assertRule(
        seeded,
        rule({ criterion: "posts_in_threads", ids: [real, 9999], value: 2 }),
        "background",
      ),
    ).toThrow(/Unknown thread: 9999/);
  });

  test("every definition says what its condition takes", () => {
    for (const definition of criterionDefinitions) {
      if (definition.kind === "groups" || definition.kind === "members")
        expect(definition.idKind).toBe(definition.kind);
      if (definition.kind === "ids") expect(definition.idKind).not.toBeNull();
      if (definition.modes.length > 0) expect(definition.idKind).not.toBeNull();
      if (definition.window) expect(definition.kind).not.toBe("boolean");
    }
  });
});
