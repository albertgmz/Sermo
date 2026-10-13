import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { traceStatements } from "../statement-trace";

type Row = {
  type?: string;
  targetType?: string;
  targetId?: number;
  id: number;
  reportCount?: number;
  excerpt: string;
  where: { kind: string; id: number; title: string } | null;
};

function world() {
  const ctx = createTestContext();
  const trace = traceStatements(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const author = insertUser(ctx);
  const reporter = userActor(insertUser(ctx));
  const forum = insertNode(ctx, { type: "forum" });
  invalidate(ctx, "node_tree");
  const call = (name: string, actor: object, input: object = {}) =>
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
    execute(ctx, getOperation(name), actor as never, input) as Promise<any>;
  const reply = async (body: string, thread: number) =>
    (await call("posts.create", userActor(author), { threadId: thread, body })).id as number;
  const thread = async (title: string, body: string) => {
    const created = await call("threads.create", userActor(author), {
      nodeId: forum.id,
      title,
      body,
    });
    return { id: created.thread.id as number, firstPostId: created.thread.firstPostId as number };
  };
  const report = (type: string, id: number) =>
    call("reports.create", reporter, { target: { type, id }, reason: "Bad" });
  const reports = async (input: object = {}) =>
    (await call("reports.list", admin, input)).items as Row[];
  const approvals = async (input: object = {}) =>
    (await call("approvals.list", admin, input)).items as Row[];
  return {
    ctx,
    trace,
    admin,
    author,
    reporter,
    forum,
    call,
    reply,
    thread,
    report,
    reports,
    approvals,
  };
}

describe("reports.list and approvals.list describe their rows", () => {
  test("a reported reply has a plain excerpt of at most 200 characters and its thread", async () => {
    const w = world();
    const topic = await w.thread("Garden talk", "First post");
    const long = `**Bold** [a link](https://example.test/x) <script>alert(1)</script> ${"word ".repeat(100)}`;
    const postId = await w.reply(long, topic.id);
    await w.report("post", postId);
    await w.report("post", postId);
    const [row] = await w.reports();
    expect(row).toMatchObject({
      targetType: "post",
      targetId: postId,
      reportCount: 2,
      where: { kind: "thread", id: topic.id, title: "Garden talk" },
    });
    expect(row!.excerpt.length).toBeLessThanOrEqual(200);
    expect(row!.excerpt.endsWith("…")).toBe(true);
    expect(row!.excerpt).toStartWith("Bold a link");
    expect(row!.excerpt).not.toMatch(/[<>*[\]]/);
  });

  test("profile content and a reported member say whose profile it is", async () => {
    const w = world();
    const owner = insertUser(w.ctx);
    const wall = w.ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO profile_posts (profile_user_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, 1, 'Wall *words*', '<p>Wall</p>') RETURNING id",
      )
      .get(owner.id, w.author.id)!.id;
    const comment = w.ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO profile_post_comments (profile_post_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, 1, 'A comment', '<p>A</p>') RETURNING id",
      )
      .get(wall, w.author.id)!.id;
    await w.report("profile_post", wall);
    await w.report("profile_post_comment", comment);
    await w.report("user", owner.id);
    const byType = Object.fromEntries((await w.reports()).map((row) => [row.targetType, row]));
    const where = { kind: "profile", id: owner.id, title: owner.username };
    expect(byType.profile_post).toMatchObject({ excerpt: "Wall words", where });
    expect(byType.profile_post_comment).toMatchObject({ excerpt: "A comment", where });
    expect(byType.user).toMatchObject({ excerpt: "", where });
  });

  test("a profile the moderator may not view is not described", async () => {
    const w = world();
    // Handles profile reports, but has no right to see around a profile's privacy.
    const handler = insertUser(w.ctx);
    await w.call("permissions.set", w.admin, {
      userId: handler.id,
      entries: [{ permission: "report.manageProfiles", value: "allow" }],
    });
    const moderator = userActor(handler);
    const owner = insertUser(w.ctx);
    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'self' WHERE id = ?1")
      .run(owner.id);
    const wall = w.ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO profile_posts (profile_user_id, user_id, created_at, body_source, body_html) VALUES (?1, ?2, 1, 'Private words', '<p>P</p>') RETURNING id",
      )
      .get(owner.id, w.author.id)!.id;
    w.ctx.sqlite
      .prepare(
        "INSERT INTO report_groups (target_type, target_id, state, report_count, created_at, updated_at) VALUES ('profile_post', ?1, 'open', 1, 1, 1)",
      )
      .run(wall);
    const seen = (await w.call("reports.list", moderator)).items as Row[];
    expect(seen).toHaveLength(1);
    // The row is there, but nothing is revealed that the profile's privacy keeps back.
    for (const row of seen) {
      expect(row.excerpt).not.toContain("Private");
      expect(row.where).toBeNull();
    }
  });

  test("messages of a conversation get no excerpt and no place", async () => {
    const w = world();
    const conversation = w.ctx.sqlite
      .prepare<{ id: number }, [number]>(
        "INSERT INTO conversations (title, user_id, created_at, last_message_at, last_message_user_id) VALUES ('Secret plans', ?1, 1, 1, ?1) RETURNING id",
      )
      .get(w.author.id)!.id;
    const message = w.ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO conversation_messages (conversation_id, user_id, created_at, body_source, body_html, state) VALUES (?1, ?2, 1, 'Private words', '<p>P</p>', 'moderated') RETURNING id",
      )
      .get(conversation, w.author.id)!.id;
    w.ctx.sqlite
      .prepare(
        "INSERT INTO report_groups (target_type, target_id, state, report_count, created_at, updated_at) VALUES ('conversation_message', ?1, 'open', 1, 1, 1)",
      )
      .run(message);
    const reported = (await w.reports()).find((row) => row.targetType === "conversation_message");
    expect(reported).toMatchObject({ excerpt: "", where: null });
    const waiting = (await w.approvals()).find((row) => row.type === "conversation_message");
    expect(waiting).toMatchObject({ id: message, excerpt: "", where: null });
    expect(JSON.stringify([reported, waiting])).not.toMatch(/Private|Secret/);
  });

  test("approvals describe moderated replies and threads", async () => {
    const w = world();
    const topic = await w.thread("Open topic", "First post");
    const held = await w.thread("Held topic", "Held *first* post");
    const postId = await w.reply("A held reply", topic.id);
    w.ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(postId);
    w.ctx.sqlite.prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1").run(held.id);
    const rows = await w.approvals();
    expect(rows.find((row) => row.type === "post")).toMatchObject({
      id: postId,
      excerpt: "A held reply",
      where: { kind: "thread", id: topic.id, title: "Open topic" },
    });
    expect(rows.find((row) => row.type === "thread")).toMatchObject({
      id: held.id,
      excerpt: "Held first post",
      where: { kind: "thread", id: held.id, title: "Held topic" },
    });
  });

  test("a page costs the same number of statements whatever its size", async () => {
    const w = world();
    const topic = await w.thread("Busy", "First post");
    for (let i = 0; i < 12; i++) {
      const id = await w.reply(`Reply ${i}`, topic.id);
      await w.report("post", id);
      w.ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(id);
    }
    await w.reports({ limit: 1 });
    await w.approvals({ limit: 1 });
    const statements = async (read: () => Promise<unknown>) => {
      w.trace.sql.length = 0;
      await read();
      return w.trace.sql.filter((sql) => /json_each[(][?]1[)]/.test(sql)).length;
    };
    for (const read of [w.reports, w.approvals]) {
      const small = await statements(() => read({ limit: 1 }));
      const large = await statements(() => read({ limit: 12 }));
      expect(large).toBe(small);
    }
  });
});
