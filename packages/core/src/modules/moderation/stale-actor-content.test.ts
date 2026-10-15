import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import type { Actor } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import { ForbiddenError, NotFoundError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { can } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { threadsCreateOp } from "../forums";

const op = (name: string) => getOperation(name);
const STAFF = [
  "report.create",
  "forum.manageReports",
  "forum.deleteAny",
  "forum.undelete",
  "forum.approve",
  "forum.lock",
  "forum.stick",
  "forum.move",
  "forum.split",
  "forum.merge",
  "forum.viewDeleted",
  "forum.viewModerated",
  "wordFilter.manage",
  "admin.settings",
  "admin.awards",
  "award.grant",
  "profile.view",
];
const entries = (permissions: string[], value: "allow" | "unset") =>
  permissions.map((permission) => ({ permission, value }));

function addPosts(ctx: Ctx, threadId: number, userId: number, count: number) {
  const insert = ctx.sqlite.prepare(
    "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
  );
  const body = ctx.sqlite.prepare(
    "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'x', '<p>x</p>')",
  );
  const first =
    ctx.sqlite
      .prepare<{ position: number }, [number]>(
        "SELECT max(position) AS position FROM posts WHERE thread_id = ?1",
      )
      .get(threadId)!.position + 1;
  const start = ctx.now() + 1000;
  let last = 0;
  for (let i = 0; i < count; i++) {
    last = Number(insert.run(threadId, userId, first + i, start + i).lastInsertRowid);
    body.run(last);
  }
  ctx.sqlite
    .prepare(
      "UPDATE threads SET reply_count = reply_count + ?2, last_post_id = ?3, last_post_at = ?4 WHERE id = ?1",
    )
    .run(threadId, count, last, start + count);
}

/**
 * A founder, and a moderator who gets every permission these writes need from a custom group.
 * `here` is the moderator's process (actor resolved, permission state warm); `elsewhere` is
 * another process, where the founder revokes the moderator. Every write has its own thread, post,
 * award or filter so that they can all succeed in one run.
 */
async function scenario() {
  const fixture = createTestContext();
  const founder = userActor(insertUser(fixture, { groupId: 4 }));
  const staffGroup = (await execute(fixture, op("groups.create"), founder, {
    title: "Moderators",
    rank: 40,
  })) as { id: number };
  await execute(fixture, op("permissions.set"), founder, {
    groupId: staffGroup.id,
    entries: entries([...STAFF, "node.view"], "allow"),
  });
  const staff = insertUser(fixture, { groupId: staffGroup.id });
  const member = insertUser(fixture);
  const other = insertUser(fixture);
  const nodeA = insertNode(fixture, {});
  const nodeB = insertNode(fixture, {});
  invalidate(fixture, "node_tree");
  const author = userActor(member);
  const thread = async (title: string) =>
    (
      (await execute(fixture, threadsCreateOp, author, {
        nodeId: nodeA.id,
        title,
        body: "Body",
      })) as { thread: { id: number } }
    ).thread.id;
  const reply = async (threadId: number) => {
    await execute(fixture, op("posts.create"), author, { threadId, body: "Reply" });
    return fixture.sqlite
      .prepare<{ id: number }, [number]>("SELECT max(id) AS id FROM posts WHERE thread_id = ?1")
      .get(threadId)!.id;
  };
  const threads = {
    sticky: await thread("Sticky"),
    lock: await thread("Lock"),
    move: await thread("Move"),
    delete: await thread("Delete"),
    restore: await thread("Restore"),
    bulk: await thread("Bulk"),
    splitSource: await thread("Split"),
    mergeTarget: await thread("Merge target"),
    mergeSource: await thread("Merge source"),
    postHolder: await thread("Posts"),
    bigMergeTarget: await thread("Big merge target"),
    bigMergeSource: await thread("Big merge source"),
    bigSplit: await thread("Big split"),
  };
  const posts = {
    state: await reply(threads.postHolder),
    delete: await reply(threads.postHolder),
    restore: await reply(threads.postHolder),
    report: await reply(threads.postHolder),
    reported: await reply(threads.postHolder),
    split: await reply(threads.splitSource),
  };
  await execute(fixture, op("threads.delete"), founder, { threadId: threads.restore });
  await execute(fixture, op("posts.delete"), founder, { postId: posts.restore });
  const group = (await execute(fixture, op("reports.create"), founder, {
    target: { type: "post", id: posts.reported },
    reason: "Spam",
  })) as { groupId: number };
  const filter = (await execute(fixture, op("wordFilters.upsert"), founder, {
    term: "alpha",
    action: "moderate",
  })) as { id: number };
  const newAward = async (name: string) =>
    (
      (await execute(fixture, op("awards.create"), founder, {
        name,
        tier: "bronze",
      })) as { id: number }
    ).id;
  const awards = {
    update: await newAward("Update"),
    delete: await newAward("Delete"),
    grant: await newAward("Grant"),
    revoke: await newAward("Revoke"),
  };
  const grant = (await execute(fixture, op("awards.grant"), founder, {
    userId: other.id,
    awardId: awards.revoke,
  })) as { id: number };

  // A merge and a split too big to finish in one request, left as if their jobs had failed.
  addPosts(fixture, threads.bigMergeTarget, member.id, 100);
  addPosts(fixture, threads.bigMergeSource, member.id, 600);
  addPosts(fixture, threads.bigSplit, member.id, 5);
  await execute(fixture, op("threads.merge"), founder, {
    threadId: threads.bigMergeTarget,
    sourceThreadIds: [threads.bigMergeSource],
  });
  const split = (await execute(fixture, op("threads.split"), founder, {
    threadId: threads.bigSplit,
    fromPosition: 1,
    title: "Split off",
    nodeId: nodeB.id,
  })) as { thread: { id: number }; completed: boolean };
  expect(split.completed).toBe(false);
  fixture.sqlite.prepare("UPDATE thread_transfers SET failed_at = ?1").run(fixture.now());
  fixture.sqlite
    .prepare("UPDATE jobs SET status = 'failed' WHERE unique_key = ?1")
    .run(`forums.split.${split.thread.id}`);
  expect(
    fixture.sqlite.prepare("SELECT count(*) AS n FROM thread_transfers").get() as { n: number },
  ).toEqual({ n: 4 });

  const database = sharedDatabase(fixture);
  const here = database.open();
  const elsewhere = database.open();
  const actor = resolvedActor(here, staff.id);
  // Warm the permission state, as a process that has been serving requests would have it.
  expect(can(here, actor, "forum.lock", { nodeId: nodeA.id })).toBe(true);
  return {
    database,
    here,
    elsewhere,
    actor,
    founder,
    staff,
    staffGroup,
    member,
    other,
    nodeB,
    threads,
    posts,
    groupId: group.groupId,
    filterId: filter.id,
    awards,
    memberAwardId: grant.id,
  };
}

type Scenario = Awaited<ReturnType<typeof scenario>>;
const revocations: Record<string, (s: Scenario) => Promise<unknown>> = {
  "their group loses its permissions": (s) =>
    execute(s.elsewhere, op("permissions.set"), s.founder, {
      groupId: s.staffGroup.id,
      entries: entries(STAFF, "unset"),
    }),
  "they are banned": (s) =>
    execute(s.elsewhere, op("bans.create"), s.founder, {
      userId: s.staff.id,
      reason: "Abuse",
      expiresAt: null,
    }),
};
const attempts: Record<string, (ctx: Ctx, actor: Actor, s: Scenario) => Promise<unknown>> = {
  "reports.create": (ctx, actor, s) =>
    execute(ctx, op("reports.create"), actor, {
      target: { type: "post", id: s.posts.report },
      reason: "Spam",
    }),
  "reports.setState": (ctx, actor, s) =>
    execute(ctx, op("reports.setState"), actor, { groupId: s.groupId, state: "resolved" }),
  "moderation.setState": (ctx, actor, s) =>
    execute(ctx, op("moderation.setState"), actor, {
      target: { type: "post", id: s.posts.state },
      state: "deleted",
    }),
  "moderation.bulk (lock)": (ctx, actor, s) =>
    execute(ctx, op("moderation.bulk"), actor, {
      targets: [{ type: "thread", id: s.threads.bulk }],
      action: "lock",
    }),
  "moderation.bulk (move)": (ctx, actor, s) =>
    execute(ctx, op("moderation.bulk"), actor, {
      targets: [{ type: "thread", id: s.threads.bulk }],
      action: "move",
      nodeId: s.nodeB.id,
    }),
  "wordFilters.upsert": (ctx, actor) =>
    execute(ctx, op("wordFilters.upsert"), actor, { term: "beta", action: "moderate" }),
  "wordFilters.remove": (ctx, actor, s) =>
    execute(ctx, op("wordFilters.remove"), actor, { filterId: s.filterId }),
  "settings.update": (ctx, actor) =>
    execute(ctx, op("settings.update"), actor, { newMemberDays: 3 }),
  "awards.create": (ctx, actor) =>
    execute(ctx, op("awards.create"), actor, { name: "Fresh", tier: "bronze" }),
  "awards.update": (ctx, actor, s) =>
    execute(ctx, op("awards.update"), actor, { awardId: s.awards.update, name: "Renamed" }),
  "awards.delete": (ctx, actor, s) =>
    execute(ctx, op("awards.delete"), actor, { awardId: s.awards.delete }),
  "awards.run": (ctx, actor) => execute(ctx, op("awards.run"), actor, {}),
  "awards.grant": (ctx, actor, s) =>
    execute(ctx, op("awards.grant"), actor, { userId: s.member.id, awardId: s.awards.grant }),
  "awards.revoke": (ctx, actor, s) =>
    execute(ctx, op("awards.revoke"), actor, { memberAwardId: s.memberAwardId }),
  "threads.setSticky": (ctx, actor, s) =>
    execute(ctx, op("threads.setSticky"), actor, { threadId: s.threads.sticky, isSticky: true }),
  "threads.setLocked": (ctx, actor, s) =>
    execute(ctx, op("threads.setLocked"), actor, { threadId: s.threads.lock, isLocked: true }),
  "threads.move": (ctx, actor, s) =>
    execute(ctx, op("threads.move"), actor, { threadId: s.threads.move, nodeId: s.nodeB.id }),
  "threads.delete": (ctx, actor, s) =>
    execute(ctx, op("threads.delete"), actor, { threadId: s.threads.delete }),
  "threads.restore": (ctx, actor, s) =>
    execute(ctx, op("threads.restore"), actor, { threadId: s.threads.restore }),
  "posts.delete": (ctx, actor, s) =>
    execute(ctx, op("posts.delete"), actor, { postId: s.posts.delete }),
  "posts.restore": (ctx, actor, s) =>
    execute(ctx, op("posts.restore"), actor, { postId: s.posts.restore }),
  "threads.split": (ctx, actor, s) =>
    execute(ctx, op("threads.split"), actor, {
      threadId: s.threads.splitSource,
      postIds: [s.posts.split],
      title: "Split out",
      nodeId: s.nodeB.id,
    }),
  "threads.split (retry)": (ctx, actor, s) =>
    execute(ctx, op("threads.split"), actor, {
      threadId: s.threads.bigSplit,
      fromPosition: 1,
      title: "Split off",
      nodeId: s.nodeB.id,
    }),
  "threads.merge": (ctx, actor, s) =>
    execute(ctx, op("threads.merge"), actor, {
      threadId: s.threads.mergeTarget,
      sourceThreadIds: [s.threads.mergeSource],
    }),
  "threads.merge (retry)": (ctx, actor, s) =>
    execute(ctx, op("threads.merge"), actor, {
      threadId: s.threads.bigMergeTarget,
      sourceThreadIds: [s.threads.bigMergeSource],
    }),
};

const TABLES = [
  "threads",
  "posts",
  "report_groups",
  "reports",
  "word_filters",
  "site_settings",
  "awards",
  "member_awards",
  "thread_transfers",
  "moderator_log",
  "jobs",
];
const snapshot = (ctx: Ctx) =>
  JSON.stringify(
    TABLES.map((table) => ctx.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
  );

// Content that a moderator cannot see answers not found, and the rest forbidden.
async function refused(attempt: Promise<unknown>) {
  const error = await attempt.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error instanceof ForbiddenError || error instanceof NotFoundError).toBe(true);
}

for (const [revoked, revoke] of Object.entries(revocations))
  for (const [name, attempt] of Object.entries(attempts))
    test(`${name} is refused to a moderator revoked meanwhile (${revoked})`, async () => {
      const s = await scenario();
      try {
        await revoke(s);
        const before = snapshot(s.elsewhere);
        await refused(attempt(s.here, s.actor, s));
        expect(snapshot(s.elsewhere)).toBe(before);
      } finally {
        s.database.close();
      }
    });

test("a moderator who was not revoked still does all of them from a second process", async () => {
  const s = await scenario();
  try {
    for (const attempt of Object.values(attempts)) await attempt(s.here, s.actor, s);
  } finally {
    s.database.close();
  }
});
