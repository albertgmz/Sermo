import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { settingsUpdate } from "../../contracts/settings";
import { ForbiddenError, RateLimitedError, ValidationError } from "../../errors";
import { phrase } from "../../i18n";
import { execute } from "../../operation";
import { PERMISSION_IDS } from "../../permissions/registry";
import { conversationsCreateOp, conversationsReplyOp } from "../conversations";
import { postsCreateOp, postsUpdateOp, threadsCreateOp } from "../forums";
import { refreshStandings } from "../members/standings";
import { profileCommentsCreateOp, profilePostsCreateOp, profilePostsUpdateOp } from "../profiles";
import { reactionsSetOp, reactionTypesCreateOp } from "../reactions";
import { readSiteSettings, type SiteSettingsValue, updateSiteSettings } from "../settings";
import { dailyLimits, floodClockSql } from "./limits";

const DAY = 86_400_000;
type Rule = SiteSettingsValue["linksRule"];
type Ctx = ReturnType<typeof createTestContext>;

function fixture() {
  const ctx = createTestContext();
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const member = insertUser(ctx);
  const other = insertUser(ctx);
  const moderator = insertUser(ctx, { groupId: 3 });
  const admin = insertUser(ctx, { groupId: 4 });
  return {
    ctx,
    node,
    member,
    other,
    moderator,
    admin,
    actor: userActor(member),
    otherActor: userActor(other),
    moderatorActor: userActor(moderator),
    adminActor: userActor(admin),
  };
}

/** Writes site settings straight to the table, as an administrator's save would. */
function configure(ctx: Ctx, changes: Record<string, unknown>) {
  ctx.sqlite
    .prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .run(JSON.stringify({ ...readSiteSettings(ctx), ...changes }), ctx.now());
}

function setEntry(ctx: Ctx, groupId: number, key: string, value: number) {
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ?1, 0, ?2 FROM permission_definitions WHERE key = ?3 ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = excluded.value",
    )
    .run(groupId, value, key);
  ctx.sqlite
    .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
    .run();
}

function removeEntry(ctx: Ctx, groupId: number, key: string) {
  ctx.sqlite
    .prepare(
      "DELETE FROM permission_entries WHERE group_id = ?1 AND user_id = 0 AND node_id = 0 AND permission_id = (SELECT id FROM permission_definitions WHERE key = ?2)",
    )
    .run(groupId, key);
  ctx.sqlite
    .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
    .run();
}

const count = (ctx: Ctx, table: string) =>
  ctx.sqlite.prepare<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()!.n;

const rejects = async (promise: Promise<unknown>, error: new (...args: never[]) => Error) => {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(error);
  return caught as Error;
};

describe("flood interval", () => {
  function writers(f: ReturnType<typeof fixture>) {
    const { ctx, node, actor, otherActor } = f;
    return {
      thread: () =>
        execute(ctx, threadsCreateOp, actor, { nodeId: node.id, title: "T", body: "b" }),
      reply: (threadId: number) =>
        execute(ctx, postsCreateOp, actor, { threadId, body: "reply", attachmentIds: [] }),
      wallPost: () =>
        execute(ctx, profilePostsCreateOp, actor, {
          userId: f.member.id,
          body: "wall",
          attachmentIds: [],
        }),
      comment: (profilePostId: number) =>
        execute(ctx, profileCommentsCreateOp, actor, { profilePostId, body: "comment" }),
      conversation: () =>
        execute(ctx, conversationsCreateOp, actor, {
          title: "C",
          recipientIds: [f.other.id],
          body: "hello",
        }),
      message: (conversationId: number) =>
        execute(ctx, conversationsReplyOp, actor, { conversationId, body: "message" }),
      otherReply: (threadId: number) =>
        execute(ctx, postsCreateOp, otherActor, { threadId, body: "reply", attachmentIds: [] }),
    };
  }

  test("threads, replies, wall posts, comments and messages share one clock", async () => {
    const f = fixture();
    const w = writers(f);
    const thread = await w.thread();
    const wall = await w.wallPost();
    const conversation = await w.conversation();
    f.ctx.clock.advance(120_000);
    configure(f.ctx, { floodSeconds: 30 });
    const kinds: [string, () => Promise<unknown>][] = [
      ["thread", () => w.thread()],
      ["reply", () => w.reply(thread.thread.id)],
      ["wallPost", () => w.wallPost()],
      ["comment", () => w.comment(wall.id)],
      ["conversation", () => w.conversation()],
      ["message", () => w.message(conversation.conversation.id)],
    ];
    for (const [name, first] of kinds) {
      await first();
      for (const [other, second] of kinds) {
        const refused = await rejects(second(), RateLimitedError);
        expect(refused.message).toContain("Please wait 30 seconds");
        expect(other).toBeString();
      }
      f.ctx.clock.advance(30_000);
      expect(name).toBeString();
    }
  });

  test("allows the next write at the interval and shows the seconds left before it", async () => {
    const f = fixture();
    const w = writers(f);
    configure(f.ctx, { floodSeconds: 30 });
    const thread = await w.thread();
    f.ctx.clock.advance(10_000);
    const refused = await rejects(w.reply(thread.thread.id), RateLimitedError);
    expect(refused.message).toBe("Please wait 20 seconds before posting again.");
    f.ctx.clock.advance(19_999);
    await rejects(w.reply(thread.thread.id), RateLimitedError);
    f.ctx.clock.advance(1);
    await w.reply(thread.thread.id);
    // The refused attempts left nothing behind.
    expect(count(f.ctx, "posts")).toBe(2);
  });

  test("is off at 0, and each member has their own clock", async () => {
    const f = fixture();
    const w = writers(f);
    const thread = await w.thread();
    await w.reply(thread.thread.id);
    configure(f.ctx, { floodSeconds: 60 });
    await rejects(w.reply(thread.thread.id), RateLimitedError);
    await w.otherReply(thread.thread.id);
    configure(f.ctx, { floodSeconds: 0 });
    await w.reply(thread.thread.id);
  });

  test("antispam.bypassFlood exempts a group; staff hold it by default", async () => {
    const f = fixture();
    const w = writers(f);
    configure(f.ctx, { floodSeconds: 600 });
    const thread = await w.thread();
    await rejects(w.reply(thread.thread.id), RateLimitedError);
    setEntry(f.ctx, 2, "antispam.bypassFlood", 1);
    await w.reply(thread.thread.id);
    await w.reply(thread.thread.id);
    removeEntry(f.ctx, 2, "antispam.bypassFlood");
    await rejects(w.reply(thread.thread.id), RateLimitedError);
    const moderator = f.moderatorActor;
    for (let i = 0; i < 3; i++)
      await execute(f.ctx, postsCreateOp, moderator, {
        threadId: thread.thread.id,
        body: "fast",
        attachmentIds: [],
      });
  });

  test("a moderated post still starts the clock", async () => {
    const f = fixture();
    const w = writers(f);
    configure(f.ctx, {
      floodSeconds: 60,
      approvalRule: { match: "all", conditions: [{ criterion: "post_count", value: 5 }] },
    });
    const held = await w.thread();
    expect(held.thread.state).toBe("moderated");
    await rejects(w.thread(), RateLimitedError);
  });
});

describe("daily limits", () => {
  const post = (f: ReturnType<typeof fixture>, threadId: number) =>
    execute(f.ctx, postsCreateOp, f.actor, { threadId, body: "reply", attachmentIds: [] });
  const thread = (f: ReturnType<typeof fixture>) =>
    execute(f.ctx, threadsCreateOp, f.actor, { nodeId: f.node.id, title: "T", body: "b" });

  test("posts per day refuses at the limit, counts new threads and releases after 24 hours", async () => {
    const f = fixture();
    const first = await thread(f);
    setEntry(f.ctx, 2, "antispam.postsPerDay", 3);
    await post(f, first.thread.id);
    await post(f, first.thread.id);
    const refused = await rejects(post(f, first.thread.id), RateLimitedError);
    expect(refused.message).toBe(
      "You have reached your limit of 3 posts in 24 hours. Try again later.",
    );
    await rejects(thread(f), RateLimitedError);
    expect(count(f.ctx, "posts")).toBe(3);
    // Another member is unaffected.
    await execute(f.ctx, postsCreateOp, f.otherActor, {
      threadId: first.thread.id,
      body: "mine",
      attachmentIds: [],
    });
    f.ctx.clock.advance(DAY - 1);
    await rejects(post(f, first.thread.id), RateLimitedError);
    f.ctx.clock.advance(2);
    await post(f, first.thread.id);
  });

  test("a deleted or held post still counts", async () => {
    const f = fixture();
    const first = await thread(f);
    setEntry(f.ctx, 2, "antispam.postsPerDay", 2);
    const reply = await post(f, first.thread.id);
    f.ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(reply.id);
    await rejects(post(f, first.thread.id), RateLimitedError);
  });

  test("threads per day limits new threads only", async () => {
    const f = fixture();
    setEntry(f.ctx, 2, "antispam.threadsPerDay", 1);
    const first = await thread(f);
    const refused = await rejects(thread(f), RateLimitedError);
    expect(refused.message).toContain("limit of 1 threads");
    await post(f, first.thread.id);
    expect(count(f.ctx, "threads")).toBe(1);
    f.ctx.clock.advance(DAY + 1);
    await thread(f);
  });

  test("-1 and 0 are both no limit, so a group made before the limit existed still writes", async () => {
    const f = fixture();
    setEntry(f.ctx, 2, "antispam.threadsPerDay", 0);
    for (let i = 0; i < 3; i++) await thread(f);
    setEntry(f.ctx, 2, "antispam.threadsPerDay", -1);
    for (let i = 0; i < 3; i++) await thread(f);
    // A group with no entry at all.
    const group = f.ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Old', 10) RETURNING id",
      )
      .get()!.id;
    for (const key of ["forum.createThread", "forum.reply", "node.view"])
      setEntry(f.ctx, group, key, 1);
    const old = userActor(insertUser(f.ctx, { groupId: group }));
    for (let i = 0; i < 3; i++)
      await execute(f.ctx, threadsCreateOp, old, { nodeId: f.node.id, title: "T", body: "b" });
  });

  test("conversations per day", async () => {
    const f = fixture();
    setEntry(f.ctx, 2, "antispam.conversationsPerDay", 1);
    const start = () =>
      execute(f.ctx, conversationsCreateOp, f.actor, {
        title: "C",
        recipientIds: [f.other.id],
        body: "hello",
      });
    const first = await start();
    const refused = await rejects(start(), RateLimitedError);
    expect(refused.message).toContain("limit of 1 conversations");
    // Messages in a conversation are not conversations, and the other limits do not apply.
    await execute(f.ctx, conversationsReplyOp, f.actor, {
      conversationId: first.conversation.id,
      body: "more",
    });
    expect(count(f.ctx, "conversations")).toBe(1);
    f.ctx.clock.advance(DAY + 1);
    await start();
  });

  test("wall posts and comments are not posts", async () => {
    const f = fixture();
    setEntry(f.ctx, 2, "antispam.postsPerDay", 1);
    await thread(f);
    await rejects(thread(f), RateLimitedError);
    const wall = await execute(f.ctx, profilePostsCreateOp, f.actor, {
      userId: f.member.id,
      body: "wall",
      attachmentIds: [],
    });
    await execute(f.ctx, profileCommentsCreateOp, f.actor, {
      profilePostId: wall.id,
      body: "comment",
    });
  });

  test("the daily counts are indexed range counts", () => {
    const f = fixture();
    const wanted = {
      "antispam.postsPerDay": "posts_user_id",
      "antispam.threadsPerDay": "threads_user_id",
      "antispam.conversationsPerDay": "conversations_user_created",
      "antispam.negativeReactionsPerDay": "reactions_negative_given",
    } as const;
    for (const [permission, { sql }] of Object.entries(dailyLimits)) {
      const plan = f.ctx.sqlite
        .prepare<{ detail: string }, [number, number]>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(1, 4)
        .map((row) => row.detail);
      const index = wanted[permission as keyof typeof wanted];
      expect(plan.some((detail) => detail.includes("SEARCH") && detail.includes(index))).toBe(true);
      expect(plan.join(String.fromCharCode(10))).not.toContain("TEMP B-TREE");
      expect(
        plan.some((detail) => /\bSCAN (?!\()/.test(detail) && !detail.includes("SUBQUERY")),
      ).toBe(false);
    }
  });

  test("the flood clock reads one row from each table through its user index", () => {
    const f = fixture();
    for (const sql of floodClockSql) {
      const plan = f.ctx.sqlite
        .prepare<{ detail: string }, [number]>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(1)
        .map((row) => row.detail);
      expect(plan.join("\n")).toMatch(/SEARCH \w+ USING INDEX \w+_user(_id)? \(user_id=\?\)/);
      expect(plan.join("\n")).not.toContain("TEMP B-TREE");
    }
  });
});

describe("negative reactions per day", () => {
  async function reactionFixture() {
    const f = fixture();
    const admin = f.adminActor;
    const kind = await execute(f.ctx, reactionTypesCreateOp, admin, {
      title: "Like",
      emoji: "+",
      score: 1,
    } as never);
    const bad = await execute(f.ctx, reactionTypesCreateOp, admin, {
      title: "Dislike",
      emoji: "-",
      score: -1,
    } as never);
    const posts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const thread = await execute(f.ctx, threadsCreateOp, f.otherActor, {
        nodeId: f.node.id,
        title: `T${i}`,
        body: "b",
      });
      posts.push(thread.post.id);
    }
    const react = (postId: number, typeId: number) =>
      execute(f.ctx, reactionsSetOp, f.actor, {
        contentType: "post",
        contentId: postId,
        reactionTypeId: typeId,
      });
    return { f, kind: kind.id as number, bad: bad.id as number, posts, react };
  }

  test("refuses the reaction past the budget; kind ones stay free", async () => {
    const { f, kind, bad, posts, react } = await reactionFixture();
    setEntry(f.ctx, 2, "antispam.negativeReactionsPerDay", 1);
    await react(posts[0]!, kind);
    await react(posts[1]!, kind);
    await react(posts[2]!, kind);
    await react(posts[0]!, bad);
    const refused = await rejects(react(posts[1]!, bad), RateLimitedError);
    expect(refused.message).toContain("limit of 1 negative reactions");
    // The refused one changed nothing.
    const row = f.ctx.sqlite
      .prepare<{ score: number }, [number, number]>(
        "SELECT score FROM reactions WHERE content_id = ?1 AND user_id = ?2",
      )
      .get(posts[1]!, f.member.id);
    expect(row?.score).toBe(1);
    f.ctx.clock.advance(DAY + 1);
    await react(posts[1]!, bad);
  });

  test("turning an old kind reaction into a negative one counts as giving it now", async () => {
    const { f, kind, bad, posts, react } = await reactionFixture();
    setEntry(f.ctx, 2, "antispam.negativeReactionsPerDay", 1);
    await react(posts[0]!, kind);
    await react(posts[1]!, kind);
    f.ctx.clock.advance(3 * DAY);
    await react(posts[0]!, bad);
    await rejects(react(posts[1]!, bad), RateLimitedError);
  });

  test("turning a kind reaction negative adds a newer row, so ids still grow with time", async () => {
    const { f, kind, bad, posts, react } = await reactionFixture();
    await react(posts[0]!, kind);
    f.ctx.clock.advance(3 * DAY);
    await react(posts[1]!, kind);
    const rows = () =>
      f.ctx.sqlite
        .prepare<{ id: number; content_id: number; score: number; created_at: number }, []>(
          "SELECT id, content_id, score, created_at FROM reactions ORDER BY id",
        )
        .all();
    const oldMax = Math.max(...rows().map((row) => row.id));
    f.ctx.clock.advance(3 * DAY);
    const turned = f.ctx.clock.now();
    await react(posts[0]!, bad);
    const after = rows();
    expect(after.length).toBe(2);
    const row = after.find((r) => r.content_id === posts[0]!)!;
    expect(row).toMatchObject({ score: -1, created_at: turned });
    expect(row.id).toBeGreaterThan(oldMax);
    // Dates never go down as ids go up: what the monthly standings bisect on.
    for (let i = 1; i < after.length; i++)
      expect(after[i]!.created_at).toBeGreaterThanOrEqual(after[i - 1]!.created_at);
    // Counts and the author's score are those of a change.
    const counts = f.ctx.sqlite
      .prepare<{ reaction_counts: string }, [number]>(
        "SELECT reaction_counts FROM posts WHERE id = ?1",
      )
      .get(posts[0]!)!.reaction_counts;
    expect(JSON.parse(counts)).toEqual({ [String(bad)]: 1 });
    expect(
      f.ctx.sqlite
        .prepare<{ reaction_score: number }, [number]>(
          "SELECT reaction_score FROM users WHERE id = ?1",
        )
        .get(f.other.id)!.reaction_score,
    ).toBe(0);
    // The month's standings count both reactions of the month to the author.
    f.ctx.clock.set(Date.UTC(2026, 1, 10));
    refreshStandings(f.ctx);
    expect(
      f.ctx.sqlite
        .prepare<{ reactions: number }, [number]>(
          "SELECT reactions FROM member_month_stats WHERE month = 202601 AND user_id = ?1",
        )
        .get(f.other.id)?.reactions,
    ).toBe(2);
  });

  test("changing one negative reaction to another is not a new one", async () => {
    const { f, bad, posts, react } = await reactionFixture();
    const worse = (await execute(f.ctx, reactionTypesCreateOp, f.adminActor, {
      title: "Worse",
      emoji: "--",
      score: -2,
    } as never)) as { id: number };
    setEntry(f.ctx, 2, "antispam.negativeReactionsPerDay", 1);
    await react(posts[0]!, bad);
    await react(posts[0]!, worse.id);
  });
});

describe("links rule", () => {
  const rule: Rule = { match: "all", conditions: [{ criterion: "post_count", value: 3 }] };

  async function post(f: ReturnType<typeof fixture>, body: string, actor = f.actor) {
    const thread = await execute(f.ctx, threadsCreateOp, f.moderatorActor, {
      nodeId: f.node.id,
      title: `T${f.ctx.now()}${Math.random()}`,
      body: "start",
    });
    return execute(f.ctx, postsCreateOp, actor, {
      threadId: thread.thread.id,
      body,
      attachmentIds: [],
    });
  }

  test("a member below the rule is refused a link and told what is missing", async () => {
    const f = fixture();
    configure(f.ctx, { linksRule: rule });
    const refused = await rejects(post(f, "see https://example.com/a"), ForbiddenError);
    expect(refused.message).toBe(
      "You cannot post links, pictures or media from other sites yet. You need Post count: 3 or more.",
    );
    expect((refused as ForbiddenError).issues?.[0]?.path).toEqual(["body"]);
    await post(f, "no link here");
    f.ctx.sqlite.prepare("UPDATE users SET post_count = 3 WHERE id = ?1").run(f.member.id);
    const linked = await post(f, "see https://example.com/a");
    expect(linked.bodyHtml).toContain('href="https://example.com/a"');
  });

  test("pictures, media, bbcode links and spoiler contents count as links", async () => {
    const f = fixture();
    configure(f.ctx, { linksRule: rule });
    for (const body of [
      "![x](https://img.example.com/a.png)",
      "[IMG]https://img.example.com/a.png[/IMG]",
      "[MEDIA=youtube]dQw4w9WgXcQ[/MEDIA]",
      "[URL=https://z.example.com]zed[/URL]",
      "[x](http://a.example.com/b)",
      ":::spoiler\nhttps://hidden.example.com\n:::",
    ])
      await rejects(post(f, body), ForbiddenError);
  });

  test("code, the site's own addresses and plain text are not links to another site", async () => {
    const f = fixture();
    configure(f.ctx, { linksRule: rule });
    await post(f, "`https://code.example.com` and example.com");
    await post(f, "my own: http://localhost:3000/threads/4");
    await post(f, "![mine](http://localhost:3000/files/a.png)");
  });

  test("also applies to wall posts and messages, and to an edit that adds a link", async () => {
    const f = fixture();
    configure(f.ctx, { linksRule: rule });
    await rejects(
      execute(f.ctx, profilePostsCreateOp, f.actor, {
        userId: f.member.id,
        body: "https://example.com",
        attachmentIds: [],
      }),
      ForbiddenError,
    );
    await rejects(
      execute(f.ctx, conversationsCreateOp, f.actor, {
        title: "C",
        recipientIds: [f.other.id],
        body: "https://example.com",
      }),
      ForbiddenError,
    );
    const mine = await post(f, "plain");
    await rejects(
      execute(f.ctx, postsUpdateOp, f.actor, {
        postId: mine.id,
        body: "now https://example.com",
        attachmentIds: [],
        reason: "",
        notify: true,
      }),
      ForbiddenError,
    );
  });

  test("a moderator editing someone else's text is not held to the rule", async () => {
    const f = fixture();
    const mine = await post(f, "plain");
    configure(f.ctx, { linksRule: rule });
    f.ctx.sqlite.prepare("UPDATE users SET post_count = 0 WHERE id = ?1").run(f.moderator.id);
    const edited = await execute(f.ctx, postsUpdateOp, f.moderatorActor, {
      postId: mine.id,
      body: "fixed https://example.com",
      attachmentIds: [],
      reason: "",
      notify: false,
    });
    expect(edited.bodyHtml).toContain("https://example.com");
  });

  test("with 'any', the refusal lists the alternatives", async () => {
    const f = fixture();
    configure(f.ctx, {
      linksRule: {
        match: "any",
        conditions: [
          { criterion: "post_count", value: 10 },
          { criterion: "days_registered", value: 7 },
        ],
      },
    });
    const refused = await rejects(post(f, "https://example.com"), ForbiddenError);
    expect(refused.message).toContain("You need one of: Post count: 10 or more; Days registered: 7 or more.");
    f.ctx.clock.advance(7 * DAY);
    await post(f, "https://example.com");
  });

  test("a rule can read groups, so staff can be let through", async () => {
    const f = fixture();
    configure(f.ctx, {
      linksRule: {
        match: "any",
        conditions: [
          { criterion: "post_count", value: 99 },
          { criterion: "in_group", ids: [3] },
        ],
      },
    });
    await rejects(post(f, "https://example.com"), ForbiddenError);
    await post(f, "https://example.com", f.moderatorActor);
  });

  test("an empty rule lets everyone link", async () => {
    const f = fixture();
    await post(f, "https://example.com");
  });

  test("settings accept only cheap criteria and name the field that is wrong", async () => {
    const f = fixture();
    const saved = updateSiteSettings(f.ctx, f.adminActor, { linksRule: rule });
    expect(saved.linksRule).toEqual(rule);
    expect(readSiteSettings(f.ctx).linksRule).toEqual(rule);
    for (const key of ["linksRule", "approvalRule"] as const) {
      const refused = (await rejects(
        Promise.resolve().then(() =>
          updateSiteSettings(f.ctx, f.adminActor, {
            [key]: { match: "all", conditions: [{ criterion: "warning_points_below", value: 3 }] },
          }),
        ),
        ValidationError,
      )) as ValidationError;
      expect(refused.issues?.[0]?.path).toEqual([key]);
      expect(refused.message).toContain("too heavy");
    }
    await rejects(
      Promise.resolve().then(() =>
        updateSiteSettings(f.ctx, f.adminActor, {
          approvalRule: { match: "all", conditions: [{ criterion: "nonsense", value: 1 }] },
        }),
      ),
      ValidationError,
    );
    expect(settingsUpdate.input.parse({ floodSeconds: 5 })).toEqual({ floodSeconds: 5 });
  });
});

describe("approval rule", () => {
  const rule: Rule = { match: "all", conditions: [{ criterion: "post_count", value: 2 }] };

  test("holds a member's threads and replies until they hold the rule", async () => {
    const f = fixture();
    configure(f.ctx, { approvalRule: rule });
    const thread = await execute(f.ctx, threadsCreateOp, f.actor, {
      nodeId: f.node.id,
      title: "First",
      body: "b",
    });
    expect(thread.thread.state).toBe("moderated");
    const held = await execute(f.ctx, postsCreateOp, f.actor, {
      threadId: thread.thread.id,
      body: "r",
      attachmentIds: [],
    });
    expect(held.state).toBe("moderated");
    f.ctx.sqlite.prepare("UPDATE users SET post_count = 2 WHERE id = ?1").run(f.member.id);
    const open = await execute(f.ctx, threadsCreateOp, f.actor, {
      nodeId: f.node.id,
      title: "Second",
      body: "b",
    });
    expect(open.thread.state).toBe("visible");
  });

  test("reads the account age, and a staff group can be let through with 'any'", async () => {
    const f = fixture();
    configure(f.ctx, {
      approvalRule: {
        match: "any",
        conditions: [
          { criterion: "days_registered", value: 3 },
          { criterion: "in_group", ids: [3, 4] },
        ],
      },
    });
    const create = (actor: typeof f.actor) =>
      execute(f.ctx, threadsCreateOp, actor, { nodeId: f.node.id, title: "T", body: "b" });
    expect((await create(f.actor)).thread.state).toBe("moderated");
    expect((await create(f.moderatorActor)).thread.state).toBe("visible");
    f.ctx.clock.advance(3 * DAY);
    expect((await create(f.actor)).thread.state).toBe("visible");
  });

  test("adds to the forum's own approval switch and leaves wall posts alone", async () => {
    const f = fixture();
    f.ctx.sqlite
      .prepare("UPDATE nodes SET require_reply_approval = 1 WHERE id = ?1")
      .run(f.node.id);
    invalidate(f.ctx, "node_tree");
    const thread = await execute(f.ctx, threadsCreateOp, f.moderatorActor, {
      nodeId: f.node.id,
      title: "T",
      body: "b",
    });
    configure(f.ctx, { approvalRule: rule });
    const reply = await execute(f.ctx, postsCreateOp, f.actor, {
      threadId: thread.thread.id,
      body: "r",
      attachmentIds: [],
    });
    expect(reply.state).toBe("moderated");
    f.ctx.sqlite.prepare("UPDATE users SET post_count = 2 WHERE id = ?1").run(f.member.id);
    const still = await execute(f.ctx, postsCreateOp, f.actor, {
      threadId: thread.thread.id,
      body: "r2",
      attachmentIds: [],
    });
    expect(still.state).toBe("moderated");
    f.ctx.sqlite.prepare("UPDATE users SET post_count = 0 WHERE id = ?1").run(f.member.id);
    const wall = await execute(f.ctx, profilePostsCreateOp, f.actor, {
      userId: f.member.id,
      body: "wall",
      attachmentIds: [],
    });
    expect(wall.state).toBe("visible");
  });
});

describe("outside pictures and media", () => {
  const body =
    "![alt text](https://img.example.com/a.png?x=1&y=2) [MEDIA=youtube]dQw4w9WgXcQ[/MEDIA] " +
    "![mine](http://localhost:3000/files/a.png)\n\n:::spoiler\n![inside](https://img.example.com/s.png)\n:::";

  async function wall(f: ReturnType<typeof fixture>) {
    return execute(f.ctx, profilePostsCreateOp, f.actor, {
      userId: f.member.id,
      body,
      attachmentIds: [],
    });
  }

  test("are embedded unless the author is held to antispam.externalMediaAsLinks", async () => {
    const f = fixture();
    const made = await wall(f);
    expect(made.bodyHtml).toContain('<img src="https://img.example.com/a.png?x=1&amp;y=2"');
    expect(made.bodyHtml).toContain("<iframe");
  });

  test("are shown as links without it, the site's own pictures excepted", async () => {
    const f = fixture();
    setEntry(f.ctx, 2, "antispam.externalMediaAsLinks", 1);
    const made = await wall(f);
    expect(made.bodyHtml).not.toContain('img.example.com/a.png?x=1&amp;y=2" alt');
    expect(made.bodyHtml).not.toContain("<iframe");
    expect(made.bodyHtml).toContain(
      '<a href="https://img.example.com/a.png?x=1&amp;y=2" rel="nofollow ugc noopener">alt text</a>',
    );
    expect(made.bodyHtml).toContain(
      '<a class="bb-media-link" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" rel="nofollow ugc noopener">https://www.youtube.com/watch?v=dQw4w9WgXcQ</a>',
    );
    expect(made.bodyHtml).toContain('<img src="http://localhost:3000/files/a.png"');
    // The text the author wrote is kept; only what readers get changes.
    expect(made.bodySource).toBe(body);
    // The spoiler is stored apart from the text and follows the same rule.
    const stored = f.ctx.sqlite
      .prepare<{ html: string }, []>("SELECT html FROM content_spoilers")
      .all()
      .map((row) => row.html)
      .join("");
    expect(stored).toContain('<a href="https://img.example.com/s.png"');
    expect(stored).not.toContain("<img");
  });
});

describe("outside media when staff edit someone else's text", () => {
  async function editedWith(held: "author" | "editor") {
    const f = fixture();
    const made = await execute(f.ctx, profilePostsCreateOp, f.actor, {
      userId: f.member.id,
      body: "plain",
      attachmentIds: [],
    });
    setEntry(f.ctx, held === "author" ? 2 : 3, "antispam.externalMediaAsLinks", 1);
    const edited = await execute(f.ctx, profilePostsUpdateOp, f.moderatorActor, {
      profilePostId: made.id,
      body: "![x](https://img.example.com/a.png)",
      attachmentIds: [],
      reason: "",
      notify: false,
    });
    return edited.bodyHtml;
  }

  test("the author's permission decides, not the editor's", async () => {
    expect(await editedWith("author")).not.toContain("<img");
    expect(await editedWith("editor")).toContain("<img");
  });
});

describe("bypassing the word filter and the spam check", () => {
  function filter(ctx: Ctx, action: "replace" | "moderate") {
    ctx.sqlite
      .prepare(
        "INSERT INTO word_filters (term, action, replacement, is_active, created_at, updated_at) VALUES ('badword', ?1, '***', 1, 0, 0)",
      )
      .run(action);
  }
  const wall = (f: ReturnType<typeof fixture>) =>
    execute(f.ctx, profilePostsCreateOp, f.actor, {
      userId: f.member.id,
      body: "a badword here",
      attachmentIds: [],
    });

  test("the word filter applies unless the group may skip it", async () => {
    const f = fixture();
    filter(f.ctx, "replace");
    expect((await wall(f)).bodySource).toBe("a *** here");
    setEntry(f.ctx, 2, "antispam.bypassWordFilter", 1);
    expect((await wall(f)).bodySource).toBe("a badword here");
  });

  test("a holding filter holds unless the group may skip it", async () => {
    const f = fixture();
    filter(f.ctx, "moderate");
    expect((await wall(f)).state).toBe("moderated");
    setEntry(f.ctx, 2, "antispam.bypassWordFilter", 1);
    expect((await wall(f)).state).toBe("visible");
  });

  test("the spam check is skipped for a group that may skip it", async () => {
    const f = fixture();
    let asked = 0;
    f.ctx.config.spamChecker = {
      async check() {
        asked += 1;
        return { spam: true, source: "akismet" };
      },
    };
    const actor = { ...f.actor, clientIp: "192.0.2.9" };
    const make = () =>
      execute(f.ctx, threadsCreateOp, actor, { nodeId: f.node.id, title: "T", body: "b" });
    expect((await make()).thread.state).toBe("moderated");
    expect(asked).toBe(1);
    setEntry(f.ctx, 2, "antispam.bypassSpamCheck", 1);
    expect((await make()).thread.state).toBe("visible");
    expect(asked).toBe(1);
  });

  test("only administrators skip either by default", () => {
    const f = fixture();
    for (const key of ["antispam.bypassWordFilter", "antispam.bypassSpamCheck"]) {
      const groups = f.ctx.sqlite
        .prepare<{ group_id: number }, [string]>(
          "SELECT group_id FROM permission_entries WHERE permission_id = (SELECT id FROM permission_definitions WHERE key = ?1) AND value = 1",
        )
        .all(key)
        .map((row) => row.group_id);
      expect(groups).toEqual([4]);
    }
  });
});

describe("registry", () => {
  test("every anti-spam permission has its label and description in both languages", () => {
    const ids = PERMISSION_IDS.filter((id) => id.startsWith("antispam."));
    expect(ids.length).toBe(8);
    for (const id of ids)
      for (const language of ["en", "es"] as const) {
        expect(phrase(language, `permission.${id}`)).toBeString();
        expect(phrase(language, `permission.${id}.description`)).toBeString();
      }
  });

  test("the built-in groups keep today's behavior until something is set", () => {
    const f = fixture();
    const value = (key: string, group: number) =>
      f.ctx.sqlite
        .prepare<{ value: number }, [string, number]>(
          "SELECT value FROM permission_entries WHERE group_id = ?2 AND permission_id = (SELECT id FROM permission_definitions WHERE key = ?1)",
        )
        .get(key, group)?.value;
    for (const key of [
      "antispam.postsPerDay",
      "antispam.threadsPerDay",
      "antispam.conversationsPerDay",
      "antispam.negativeReactionsPerDay",
    ])
      for (const group of [2, 3, 4, 5]) expect(value(key, group)).toBe(-1);
    // Nobody is held to showing outside media as links, and administrators never are.
    for (const group of [2, 3, 5])
      expect(value("antispam.externalMediaAsLinks", group)).toBeUndefined();
    expect(value("antispam.externalMediaAsLinks", 4)).toBe(-1);
    expect(value("antispam.bypassFlood", 2)).toBeUndefined();
    expect(value("antispam.bypassFlood", 3)).toBe(1);
  });

  test("the settings read back with the new keys at their defaults", () => {
    const f = fixture();
    const settings = readSiteSettings(f.ctx);
    expect(settings.floodSeconds).toBe(0);
    expect(settings.linksRule).toEqual({ match: "all", conditions: [] });
    expect(settings.approvalRule).toEqual({ match: "all", conditions: [] });
  });
});
