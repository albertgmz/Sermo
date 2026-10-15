import { afterEach, describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext, invalidate } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedPermissions } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { SCAN_CAP } from "../feed/scan";
import { announcementsSql, approvalMessageSql, bansSql } from "./sanctions";

const DAY = 86_400_000;
const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});
// biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
type Run = (name: string, actor: object, input?: object) => Promise<any>;

function world() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const run: Run = (name, actor, input = {}) =>
    execute(ctx, getOperation(name), actor as never, input);
  const founder = insertUser(ctx, { groupId: 4, username: "Founder" });
  const moderator = insertUser(ctx, { groupId: 3, username: "Moderator" });
  const member = insertUser(ctx, { username: "Plain" });
  return { ctx, run, founder, moderator, member };
}

describe("bans.list", () => {
  test("lists the register newest first with who, why, when and the state", async () => {
    const w = world();
    const a = insertUser(w.ctx, { username: "A" });
    const b = insertUser(w.ctx, { username: "B" });
    const c = insertUser(w.ctx, { username: "C" });
    const d = insertUser(w.ctx, { username: "D" });
    const ban = (userId: number, expiresAt: string | null) =>
      w.run("bans.create", userActor(w.founder), {
        userId,
        reason: `Why ${userId}`,
        expiresAt,
        notify: false,
      });
    const lifted = await ban(a.id, null);
    await w.run("bans.lift", userActor(w.founder), {
      banId: lifted.id,
      reason: "ok",
      notify: false,
    });
    await ban(b.id, new Date(w.ctx.now() + DAY).toISOString());
    await ban(c.id, null);
    w.ctx.clock.advance(2 * DAY);
    await ban(d.id, new Date(w.ctx.now() + DAY).toISOString());
    const all = await w.run("bans.list", userActor(w.founder), {});
    expect(
      all.items.map((item: { user: { username: string }; state: string }) => [
        item.user.username,
        item.state,
      ]),
    ).toEqual([
      ["D", "active"],
      ["C", "active"],
      ["B", "expired"],
      ["A", "lifted"],
    ]);
    expect(all.items[0]).toMatchObject({
      moderator: { username: "Founder" },
      reason: `Why ${d.id}`,
      liftedAt: null,
    });
    expect(all.items[1].expiresAt).toBeNull();
    expect(all.items[3].liftedAt).not.toBeNull();
    const state = async (value: string) =>
      (await w.run("bans.list", userActor(w.founder), { state: value })).items.map(
        (item: { user: { username: string } }) => item.user.username,
      );
    expect(await state("active")).toEqual(["D", "C"]);
    expect(await state("expired")).toEqual(["B"]);
    expect(await state("lifted")).toEqual(["A"]);
    const one = await w.run("bans.list", userActor(w.founder), { userId: c.id });
    expect(one.items).toHaveLength(1);
    const first = await w.run("bans.list", userActor(w.founder), { limit: 3 });
    const rest = await w.run("bans.list", userActor(w.founder), { cursor: first.nextCursor });
    expect(first.items).toHaveLength(3);
    expect(rest.items.map((item: { user: { username: string } }) => item.user.username)).toEqual([
      "A",
    ]);
    expect(rest.nextCursor).toBeNull();
  });

  test("a rare state pages through bounded batches", async () => {
    const w = world();
    const target = insertUser(w.ctx, { username: "Target" });
    const old = await w.run("bans.create", userActor(w.founder), {
      userId: target.id,
      reason: "Old",
      expiresAt: null,
      notify: false,
    });
    await w.run("bans.lift", userActor(w.founder), { banId: old.id, reason: "ok", notify: false });
    for (let i = 0; i < 450; i++)
      w.ctx.sqlite
        .prepare(
          "INSERT INTO bans (user_id, moderator_id, reason, created_at, expires_at, lifted_at) VALUES (?1, ?2, 'x', 0, NULL, 1)",
        )
        .run(w.member.id, w.founder.id);
    // 450 lifted bans sit between: the first call stops at its cap with a cursor to continue.
    const first = await w.run("bans.list", userActor(w.founder), { state: "active", limit: 5 });
    expect(first.items).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    let cursor: string | null = first.nextCursor;
    let found = 0;
    while (cursor) {
      const page: { items: unknown[]; nextCursor: string | null } = await w.run(
        "bans.list",
        userActor(w.founder),
        { state: "lifted", limit: 100, cursor },
      );
      found += page.items.length;
      cursor = page.nextCursor;
    }
    expect(found).toBeGreaterThan(0);
  });

  test("requires member.ban", async () => {
    const w = world();
    await expect(w.run("bans.list", GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(w.run("bans.list", userActor(w.member))).rejects.toBeInstanceOf(ForbiddenError);
    // Moderators hold member.ban by default (migration 0052), so they list bans.
    await w.run("bans.list", userActor(w.moderator));
    await w.run("permissions.set", userActor(w.founder), {
      userId: w.member.id,
      entries: [{ permission: "member.ban", value: "allow" }],
    });
    await w.run("bans.list", resolvedActor(w.ctx, w.member.id));
    await w.run("bans.list", tokenActor(w.founder));
  });

  test("the statements read the key or the member's index", () => {
    const w = world();
    expectNoTableScan(w.ctx, bansSql.all, [100, 10]);
    // One member has a handful of bans: ordering them is a small sort.
    expectNoTableScan(w.ctx, bansSql.member, [100, 10, 1], { allowTempBTree: true });
  });
});

describe("announcements.list", () => {
  test("lists the announcements newest first with their author", async () => {
    const w = world();
    const other = insertUser(w.ctx, { groupId: 4, username: "Other Admin" });
    await w.run("announcements.create", userActor(w.founder), {
      title: "One",
      body: "First [B]post[/B]",
    });
    w.ctx.clock.advance(1000);
    await w.run("announcements.create", userActor(other), { title: "Two", body: "Second" });
    const page = await w.run("announcements.list", userActor(w.founder), { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ title: "Two", author: { username: "Other Admin" } });
    const rest = await w.run("announcements.list", userActor(w.founder), {
      cursor: page.nextCursor,
    });
    expect(rest.items[0]).toMatchObject({ title: "One", author: { username: "Founder" } });
    expect(rest.items[0].bodyHtml).toContain("<strong>post</strong>");
    expect(rest.nextCursor).toBeNull();
    expectNoTableScan(w.ctx, announcementsSql, [100, 10]);
  });

  test("shows the link and the audience of each announcement", async () => {
    const w = world();
    const target = insertUser(w.ctx, { username: "Target" });
    await w.run("announcements.create", userActor(w.founder), { title: "All", body: "x" });
    w.ctx.clock.advance(1000);
    await w.run("announcements.create", userActor(w.founder), {
      title: "Group",
      body: "x",
      url: "/pages/rules",
      audience: { kind: "group", groupId: 3 },
    });
    w.ctx.clock.advance(1000);
    await w.run("announcements.create", userActor(w.founder), {
      title: "Named",
      body: "x",
      audience: { kind: "users", usernames: ["target"] },
    });
    const { items } = await w.run("announcements.list", userActor(w.founder), {});
    expect(items.map((item: { audience: unknown }) => item.audience)).toEqual([
      { kind: "users", usernames: [target.username] },
      { kind: "group", groupId: 3 },
      { kind: "all" },
    ]);
    expect(items.map((item: { url: unknown }) => item.url)).toEqual([null, "/pages/rules", null]);
  });

  test("requires admin.announcements", async () => {
    const w = world();
    await expect(w.run("announcements.list", GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(w.run("announcements.list", userActor(w.member))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(w.run("announcements.list", userActor(w.moderator))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await w.run("announcements.list", tokenActor(w.founder));
  });
});

describe("approvals.viewConversationMessage", () => {
  async function conversation() {
    const w = world();
    const other = insertUser(w.ctx, { username: "Other" });
    const started = await w.run("conversations.create", userActor(w.member), {
      title: "Private talk",
      recipientIds: [other.id],
      body: "Message 0",
    });
    const conversationId = started.conversation.id as number;
    const ids: number[] = [started.message.id];
    for (let i = 1; i <= 8; i++) {
      const sender = i % 2 ? userActor(other) : userActor(w.member);
      ids.push(
        (await w.run("conversations.reply", sender, { conversationId, body: `Message ${i}` })).id,
      );
    }
    return { w, other, conversationId, ids };
  }

  test("shows a message awaiting approval with three either side, and logs the view", async () => {
    const { w, ids, conversationId } = await conversation();
    w.ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'moderated' WHERE id = ?1")
      .run(ids[4]!);
    const view = await w.run("approvals.viewConversationMessage", userActor(w.founder), {
      messageId: ids[4],
    });
    expect(view.conversationId).toBe(conversationId);
    expect(view.title).toBe("Private talk");
    expect(view.messages.map((m: { id: number }) => m.id)).toEqual(ids.slice(1, 8));
    expect(
      view.messages
        .filter((m: { isTarget: boolean }) => m.isTarget)
        .map((m: { id: number }) => m.id),
    ).toEqual([ids[4]]);
    expect(view.messages[3].author.username).toBeDefined();
    expect(
      w.ctx.sqlite
        .prepare<{ action: string; target_type: string; target_id: number }, []>(
          "SELECT action, target_type, target_id FROM moderator_log",
        )
        .all(),
    ).toEqual([
      {
        action: "conversation_message.view",
        target_type: "conversation_message",
        target_id: ids[4]!,
      },
    ]);
    expectNoTableScan(w.ctx, approvalMessageSql.target, [1]);
    expectNoTableScan(w.ctx, approvalMessageSql.before, [1, 5]);
    expectNoTableScan(w.ctx, approvalMessageSql.after, [1, 5]);
  });

  test("the messages around it are only those a participant would see", async () => {
    const { w, ids } = await conversation();
    const state = (id: number, value: string) =>
      w.ctx.sqlite
        .prepare("UPDATE conversation_messages SET state = ?1 WHERE id = ?2")
        .run(value, id);
    state(ids[4]!, "moderated");
    // Next to it: one deleted, one waiting for approval too.
    state(ids[3]!, "deleted");
    state(ids[5]!, "moderated");
    const view = await w.run("approvals.viewConversationMessage", userActor(w.founder), {
      messageId: ids[4],
    });
    expect(view.messages.map((m: { id: number }) => m.id)).toEqual([
      ids[0],
      ids[1],
      ids[2],
      ids[4],
      ids[6],
      ids[7],
      ids[8],
    ]);
    expect(
      view.messages
        .filter((m: { isTarget: boolean }) => m.isTarget)
        .map((m: { id: number }) => m.id),
    ).toEqual([ids[4]]);
  });

  test("a message that is not in the approval queue is not found and nothing is logged", async () => {
    const { w, ids } = await conversation();
    await expect(
      w.run("approvals.viewConversationMessage", userActor(w.founder), { messageId: ids[2] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    w.ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'deleted' WHERE id = ?1")
      .run(ids[2]!);
    await expect(
      w.run("approvals.viewConversationMessage", userActor(w.founder), { messageId: ids[2] }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      w.run("approvals.viewConversationMessage", userActor(w.founder), { messageId: 99999 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(w.ctx.sqlite.prepare("SELECT 1 FROM moderator_log").get()).toBeNull();
  });

  test("requires conversation.moderate, a participant has no way in", async () => {
    const { w, ids, other } = await conversation();
    w.ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'moderated' WHERE id = ?1")
      .run(ids[4]!);
    const input = { messageId: ids[4] };
    await expect(w.run("approvals.viewConversationMessage", GUEST, input)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    for (const who of [w.member, other, w.moderator])
      await expect(
        w.run("approvals.viewConversationMessage", userActor(who), input),
      ).rejects.toBeInstanceOf(ForbiddenError);
    await w.run("approvals.viewConversationMessage", tokenActor(w.founder), input);
  });

  test("an administrator revoked in another process reads and logs nothing", async () => {
    const { w, ids } = await conversation();
    w.ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'moderated' WHERE id = ?1")
      .run(ids[4]!);
    const reader = insertUser(w.ctx, { groupId: 3, username: "Reader" });
    await w.run("permissions.set", userActor(w.founder), {
      userId: reader.id,
      entries: [{ permission: "conversation.moderate", value: "allow" }],
    });
    const database = sharedDatabase(w.ctx);
    try {
      const here = database.open();
      const elsewhere = database.open();
      const stale = resolvedActor(here, reader.id);
      resolvedPermissions(here, stale);
      await execute(
        elsewhere,
        getOperation("permissions.set"),
        resolvedActor(elsewhere, w.founder.id),
        {
          userId: reader.id,
          entries: [{ permission: "conversation.moderate", value: "unset" }],
        },
      );
      // The early check sees a stale grant; the read is then logged in a transaction. The
      // permission is the same one the log needs, so the stale reader is refused there.
      const attempt = execute(here, getOperation("approvals.viewConversationMessage"), stale, {
        messageId: ids[4],
      });
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
      expect(
        here.sqlite
          .prepare("SELECT 1 FROM moderator_log WHERE action = 'conversation_message.view'")
          .get(),
      ).toBeNull();
    } finally {
      database.close();
    }
  });
});

describe("moderatorLog.list filters", () => {
  function logged() {
    const w = world();
    const node = insertNode(w.ctx, { title: "Forum", type: "forum" });
    invalidate(w.ctx, "node_tree");
    const insert = (actorId: number, action: string, nodeId: number | null = null) => {
      w.ctx.clock.advance(1000);
      w.ctx.sqlite
        .prepare(
          "INSERT INTO moderator_log (actor_id, action, target_type, target_id, reason, details, created_at, node_id) VALUES (?1, ?2, 'x', 1, '', '{}', ?3, ?4)",
        )
        .run(actorId, action, w.ctx.now(), nodeId);
    };
    insert(w.founder.id, "settings.update");
    insert(w.moderator.id, "post.edit", node.id);
    insert(w.founder.id, "navigation.create");
    insert(w.moderator.id, "settings.theme");
    insert(w.founder.id, "post.delete", node.id);
    const actions = async (input: object) =>
      (await w.run("moderatorLog.list", userActor(w.founder), { limit: 50, ...input })).items.map(
        (item: { action: string }) => item.action,
      );
    return { w, node, actions };
  }

  test("by actor, by action prefix, by both, and with a node", async () => {
    const { w, node, actions } = logged();
    expect(await actions({})).toHaveLength(5);
    expect(await actions({ actorId: w.moderator.id })).toEqual(["settings.theme", "post.edit"]);
    expect(await actions({ action: "settings." })).toEqual(["settings.theme", "settings.update"]);
    expect(await actions({ action: "post.d" })).toEqual(["post.delete"]);
    expect(await actions({ action: "nothing" })).toEqual([]);
    expect(await actions({ actorId: w.founder.id, action: "settings." })).toEqual([
      "settings.update",
    ]);
    expect(await actions({ nodeId: node.id, actorId: w.moderator.id })).toEqual(["post.edit"]);
    expect(await actions({ nodeId: node.id, action: "post.e" })).toEqual(["post.edit"]);
  });

  test("a filter that rejects rows pages on with a cursor", async () => {
    const { w, actions } = logged();
    void actions;
    for (let i = 0; i < 30; i++) {
      w.ctx.clock.advance(1000);
      w.ctx.sqlite
        .prepare(
          "INSERT INTO moderator_log (actor_id, action, target_type, target_id, reason, details, created_at) VALUES (?1, 'bulk.noise', 'x', 1, '', '{}', ?2)",
        )
        .run(w.founder.id, w.ctx.now());
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await w.run("moderatorLog.list", userActor(w.founder), {
        limit: 2,
        action: "settings.",
        cursor,
      });
      seen.push(...page.items.map((item: { action: string }) => item.action));
      cursor = page.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(seen).toEqual(["settings.theme", "settings.update"]);
  });

  describe("an action prefix that matches little", () => {
    /** Rows the log statements hand back, counted from now on. Call before the first request. */
    function countLogRows(w: ReturnType<typeof world>) {
      let rows = 0;
      const original = w.ctx.sqlite.prepare.bind(w.ctx.sqlite);
      // biome-ignore lint/suspicious/noExplicitAny: wraps whatever statement is prepared
      (w.ctx.sqlite as any).prepare = (sql: string) => {
        const statement = original(sql);
        if (sql.includes("FROM moderator_log")) {
          const all = statement.all.bind(statement);
          statement.all = ((...args: unknown[]) => {
            const found = all(...(args as never[]));
            rows += found.length;
            return found;
          }) as typeof statement.all;
        }
        return statement;
      };
      return () => rows;
    }

    /** Oldest first: a match, noise, a match, noise, a match, then the newest noise. */
    function sparse(w: ReturnType<typeof world>, actorId: number) {
      const insert = w.ctx.sqlite.prepare(
        "INSERT INTO moderator_log (actor_id, action, target_type, target_id, reason, details, created_at) VALUES (?1, ?2, 'x', 1, '', '{}', ?3)",
      );
      const add = (action: string, count: number) => {
        for (let i = 0; i < count; i++) {
          w.ctx.clock.advance(1);
          insert.run(actorId, action, w.ctx.now());
        }
      };
      w.ctx.sqlite.transaction(() => {
        add("rare.first", 1);
        add("bulk.noise", 1000);
        add("rare.second", 1);
        add("bulk.noise", 1500);
        add("rare.third", 1);
        add("bulk.noise", 500);
      })();
    }

    for (const filter of ["none", "actor"] as const)
      test(`every match is reachable by following cursors, and a call examines a bounded number of rows (${filter})`, async () => {
        const w = world();
        sparse(w, w.founder.id);
        const examined = countLogRows(w);
        const seen: string[] = [];
        let cursor: string | undefined;
        let calls = 0;
        let before = 0;
        let first: { items: unknown[]; nextCursor: string | null } | undefined;
        do {
          const page: { items: { action: string }[]; nextCursor: string | null } = await w.run(
            "moderatorLog.list",
            userActor(w.founder),
            {
              limit: 50,
              action: "rare.",
              ...(filter === "actor" ? { actorId: w.founder.id } : {}),
              cursor,
            },
          );
          first ??= page;
          // At most the bound, plus the one row that tells whether the log goes on.
          expect(examined() - before).toBeLessThanOrEqual(SCAN_CAP + 1);
          before = examined();
          seen.push(...page.items.map((item) => item.action));
          cursor = page.nextCursor ?? undefined;
          calls++;
        } while (cursor && calls < 50);
        expect(examined()).toBeGreaterThan(3000);
        expect(seen).toEqual(["rare.third", "rare.second", "rare.first"]);
        expect(calls).toBeGreaterThanOrEqual(Math.ceil(3000 / SCAN_CAP));
        // The newest rows match nothing: the first page is empty but says where to go on.
        expect(first!.items).toEqual([]);
        expect(first!.nextCursor).not.toBeNull();
      });
  });

  test("the visibility rule is unchanged: a forum moderator sees only their forum's entries", async () => {
    const { w, node } = logged();
    const helper = insertUser(w.ctx, { username: "Helper" });
    await w.run("permissions.set", userActor(w.founder), {
      userId: helper.id,
      entries: [{ permission: "node.view", value: "allow" }],
    });
    await w.run("permissions.set", userActor(w.founder), {
      userId: helper.id,
      nodeId: node.id,
      entries: [{ permission: "forum.viewLog", value: "allow" }],
    });
    const actor = resolvedActor(w.ctx, helper.id);
    const seen = async (input: object) =>
      (await w.run("moderatorLog.list", actor, { limit: 50, ...input })).items.map(
        (item: { action: string }) => item.action,
      );
    expect(await seen({ nodeId: node.id })).toEqual(["post.delete", "post.edit"]);
    expect(await seen({ actorId: w.founder.id })).toEqual(["post.delete"]);
    expect(await seen({ action: "settings." })).toEqual([]);
    await expect(
      w.run("moderatorLog.list", userActor(w.member), { actorId: w.founder.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
