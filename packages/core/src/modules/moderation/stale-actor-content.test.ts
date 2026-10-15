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
/** What lets a moderator see content. Losing only these hides it. */
const VIEW = [
  "node.view",
  "forum.viewDeleted",
  "forum.viewModerated",
  "profile.view",
  "profilePost.viewDeleted",
];
/** What lets a moderator act on content they can see. */
const ACTIONS = [
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
  "forum.editAny",
  "wordFilter.manage",
  "admin.settings",
  "admin.awards",
  "award.grant",
  "profilePost.editAny",
  "profilePost.deleteAny",
  "profilePost.undelete",
  "conversation.moderate",
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
 * award, filter or wall post so that they can all succeed in one run.
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
    entries: entries([...VIEW, ...ACTIONS], "allow"),
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
    update: await thread("Update"),
    cover: await thread("Cover"),
    bulk: await thread("Bulk"),
    splitSource: await thread("Split"),
    mergeTarget: await thread("Merge target"),
    mergeSource: await thread("Merge source"),
    postHolder: await thread("Posts"),
    movedPosts: await thread("Moved posts"),
    bigMergeTarget: await thread("Big merge target"),
    bigMergeSource: await thread("Big merge source"),
    bigSplit: await thread("Big split"),
  };
  const threadInB = (
    (await execute(fixture, threadsCreateOp, author, {
      nodeId: nodeB.id,
      title: "Elsewhere",
      body: "Body",
    })) as { thread: { id: number } }
  ).thread.id;
  fixture.sqlite.prepare("UPDATE threads SET cover_id = 1 WHERE id = ?1").run(threads.cover);
  const posts = {
    state: await reply(threads.postHolder),
    stateRestore: await reply(threads.postHolder),
    delete: await reply(threads.postHolder),
    restore: await reply(threads.postHolder),
    update: await reply(threads.postHolder),
    report: await reply(threads.postHolder),
    reported: await reply(threads.postHolder),
    split: await reply(threads.splitSource),
    moved: await reply(threads.movedPosts),
  };
  await execute(fixture, op("threads.delete"), founder, { threadId: threads.restore });
  await execute(fixture, op("posts.delete"), founder, { postId: posts.restore });
  await execute(fixture, op("moderation.setState"), founder, {
    target: { type: "post", id: posts.stateRestore },
    state: "deleted",
  });
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

  // Private conversation messages, reported by a participant.
  const conversation = (await execute(fixture, op("conversations.create"), author, {
    title: "Private",
    recipientIds: [other.id],
    body: "Secret",
  })) as { message: { id: number } };
  const conversationReport = (await execute(fixture, op("reports.create"), author, {
    target: { type: "conversation_message", id: conversation.message.id },
    reason: "Abuse",
  })) as { groupId: number };

  // Wall posts and comments of the member.
  const wallPost = async (body: string) =>
    (
      (await execute(fixture, op("profilePosts.create"), author, {
        userId: member.id,
        body,
      })) as { id: number }
    ).id;
  const wall = {
    update: await wallPost("Update"),
    delete: await wallPost("Delete"),
    restore: await wallPost("Restore"),
    host: await wallPost("Host"),
  };
  await execute(fixture, op("profilePosts.delete"), founder, { profilePostId: wall.restore });
  const wallComment = async (body: string) =>
    (
      (await execute(fixture, op("profileComments.create"), author, {
        profilePostId: wall.host,
        body,
      })) as { id: number }
    ).id;
  const comments = {
    update: await wallComment("Update"),
    delete: await wallComment("Delete"),
    restore: await wallComment("Restore"),
  };
  await execute(fixture, op("profileComments.delete"), founder, { commentId: comments.restore });

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
    nodeA,
    nodeB,
    threads,
    threadInB,
    posts,
    groupId: group.groupId,
    conversationGroupId: conversationReport.groupId,
    filterId: filter.id,
    awards,
    memberAwardId: grant.id,
    wall,
    comments,
  };
}

type Scenario = Awaited<ReturnType<typeof scenario>>;
type ErrorClass = typeof ForbiddenError | typeof NotFoundError;
const F = ForbiddenError;
const N = NotFoundError;

/**
 * One write, and the error it must give a moderator who meanwhile lost the permission to do it
 * (`lost`), was banned (`banned`), or lost sight of the forum it is in (`sight`; absent when
 * seeing the forum is not part of the rule). Content a moderator cannot see answers not found.
 */
const attempts: Record<
  string,
  {
    run: (ctx: Ctx, actor: Actor, s: Scenario) => Promise<unknown>;
    lost: ErrorClass;
    banned: ErrorClass;
    sight?: ErrorClass;
  }
> = {
  "reports.create": {
    run: (ctx, actor, s) =>
      execute(ctx, op("reports.create"), actor, {
        target: { type: "post", id: s.posts.report },
        reason: "Spam",
      }),
    lost: F,
    banned: F,
    sight: N,
  },
  "reports.setState": {
    run: (ctx, actor, s) =>
      execute(ctx, op("reports.setState"), actor, { groupId: s.groupId, state: "resolved" }),
    lost: N,
    banned: N,
  },
  "reports.viewConversationMessage": {
    run: (ctx, actor, s) =>
      execute(ctx, op("reports.viewConversationMessage"), actor, {
        groupId: s.conversationGroupId,
      }),
    lost: F,
    banned: F,
  },
  "moderation.setState (delete)": {
    run: (ctx, actor, s) =>
      execute(ctx, op("moderation.setState"), actor, {
        target: { type: "post", id: s.posts.state },
        state: "deleted",
      }),
    lost: N,
    banned: N,
  },
  "moderation.setState (restore)": {
    run: (ctx, actor, s) =>
      execute(ctx, op("moderation.setState"), actor, {
        target: { type: "post", id: s.posts.stateRestore },
        state: "visible",
      }),
    lost: N,
    banned: N,
  },
  "moderation.bulk (lock)": {
    run: (ctx, actor, s) =>
      execute(ctx, op("moderation.bulk"), actor, {
        targets: [{ type: "thread", id: s.threads.bulk }],
        action: "lock",
      }),
    lost: N,
    banned: N,
  },
  "moderation.bulk (move)": {
    run: (ctx, actor, s) =>
      execute(ctx, op("moderation.bulk"), actor, {
        targets: [{ type: "thread", id: s.threads.bulk }],
        action: "move",
        nodeId: s.nodeB.id,
      }),
    lost: N,
    banned: N,
  },
  "wordFilters.upsert": {
    run: (ctx, actor) =>
      execute(ctx, op("wordFilters.upsert"), actor, { term: "beta", action: "moderate" }),
    lost: F,
    banned: F,
  },
  "wordFilters.remove": {
    run: (ctx, actor, s) => execute(ctx, op("wordFilters.remove"), actor, { filterId: s.filterId }),
    lost: F,
    banned: F,
  },
  "settings.update": {
    run: (ctx, actor) => execute(ctx, op("settings.update"), actor, { newMemberDays: 3 }),
    lost: F,
    banned: F,
  },
  "awards.create": {
    run: (ctx, actor) =>
      execute(ctx, op("awards.create"), actor, { name: "Fresh", tier: "bronze" }),
    lost: F,
    banned: F,
  },
  "awards.update": {
    run: (ctx, actor, s) =>
      execute(ctx, op("awards.update"), actor, { awardId: s.awards.update, name: "Renamed" }),
    lost: F,
    banned: F,
  },
  "awards.delete": {
    run: (ctx, actor, s) => execute(ctx, op("awards.delete"), actor, { awardId: s.awards.delete }),
    lost: F,
    banned: F,
  },
  "awards.run": {
    run: (ctx, actor) => execute(ctx, op("awards.run"), actor, {}),
    lost: F,
    banned: F,
  },
  "awards.grant": {
    run: (ctx, actor, s) =>
      execute(ctx, op("awards.grant"), actor, { userId: s.member.id, awardId: s.awards.grant }),
    lost: F,
    banned: F,
  },
  "awards.revoke": {
    run: (ctx, actor, s) =>
      execute(ctx, op("awards.revoke"), actor, { memberAwardId: s.memberAwardId }),
    lost: F,
    banned: F,
  },
  "threads.setSticky": {
    run: (ctx, actor, s) =>
      execute(ctx, op("threads.setSticky"), actor, { threadId: s.threads.sticky, isSticky: true }),
    lost: F,
    banned: N,
    sight: N,
  },
  "threads.setLocked": {
    run: (ctx, actor, s) =>
      execute(ctx, op("threads.setLocked"), actor, { threadId: s.threads.lock, isLocked: true }),
    lost: F,
    banned: N,
    sight: N,
  },
  "threads.move": {
    run: (ctx, actor, s) =>
      execute(ctx, op("threads.move"), actor, { threadId: s.threads.move, nodeId: s.nodeB.id }),
    lost: F,
    banned: N,
    sight: N,
  },
  "threads.delete": {
    run: (ctx, actor, s) =>
      execute(ctx, op("threads.delete"), actor, { threadId: s.threads.delete }),
    lost: F,
    banned: N,
    sight: N,
  },
  "threads.restore": {
    run: (ctx, actor, s) =>
      execute(ctx, op("threads.restore"), actor, { threadId: s.threads.restore }),
    lost: F,
    banned: N,
    sight: N,
  },
  "threads.update": {
    run: (ctx, actor, s) =>
      execute(ctx, op("threads.update"), actor, { threadId: s.threads.update, title: "Renamed" }),
    lost: F,
    banned: N,
    sight: N,
  },
  "threads.removeCover": {
    run: (ctx, actor, s) =>
      execute(ctx, op("threads.removeCover"), actor, { threadId: s.threads.cover }),
    lost: F,
    banned: N,
    sight: N,
  },
  "posts.update": {
    run: (ctx, actor, s) =>
      execute(ctx, op("posts.update"), actor, { postId: s.posts.update, body: "Edited" }),
    lost: F,
    banned: N,
    sight: N,
  },
  "posts.delete": {
    run: (ctx, actor, s) => execute(ctx, op("posts.delete"), actor, { postId: s.posts.delete }),
    lost: F,
    banned: N,
    sight: N,
  },
  "posts.restore": {
    run: (ctx, actor, s) => execute(ctx, op("posts.restore"), actor, { postId: s.posts.restore }),
    lost: F,
    banned: N,
    sight: N,
  },
  "threads.split": {
    run: (ctx, actor, s) =>
      execute(ctx, op("threads.split"), actor, {
        threadId: s.threads.splitSource,
        postIds: [s.posts.split],
        title: "Split out",
        nodeId: s.nodeB.id,
      }),
    lost: F,
    banned: N,
    sight: N,
  },
  "threads.split (retry)": {
    run: (ctx, actor, s) =>
      execute(ctx, op("threads.split"), actor, {
        threadId: s.threads.bigSplit,
        fromPosition: 1,
        title: "Split off",
        nodeId: s.nodeB.id,
      }),
    lost: F,
    banned: N,
    sight: N,
  },
  "threads.merge": {
    run: (ctx, actor, s) =>
      execute(ctx, op("threads.merge"), actor, {
        threadId: s.threads.mergeTarget,
        sourceThreadIds: [s.threads.mergeSource],
      }),
    lost: F,
    banned: N,
    sight: N,
  },
  "threads.merge (retry)": {
    run: (ctx, actor, s) =>
      execute(ctx, op("threads.merge"), actor, {
        threadId: s.threads.bigMergeTarget,
        sourceThreadIds: [s.threads.bigMergeSource],
      }),
    lost: F,
    banned: N,
    sight: N,
  },
  "profilePosts.update": {
    run: (ctx, actor, s) =>
      execute(ctx, op("profilePosts.update"), actor, {
        profilePostId: s.wall.update,
        body: "Edited",
      }),
    lost: F,
    banned: F,
  },
  "profilePosts.delete": {
    run: (ctx, actor, s) =>
      execute(ctx, op("profilePosts.delete"), actor, { profilePostId: s.wall.delete }),
    lost: F,
    banned: F,
  },
  "profilePosts.restore": {
    run: (ctx, actor, s) =>
      execute(ctx, op("profilePosts.restore"), actor, { profilePostId: s.wall.restore }),
    lost: F,
    banned: F,
  },
  "profileComments.update": {
    run: (ctx, actor, s) =>
      execute(ctx, op("profileComments.update"), actor, {
        commentId: s.comments.update,
        body: "Edited",
      }),
    lost: F,
    banned: F,
  },
  "profileComments.delete": {
    run: (ctx, actor, s) =>
      execute(ctx, op("profileComments.delete"), actor, { commentId: s.comments.delete }),
    lost: F,
    banned: F,
  },
  "profileComments.restore": {
    run: (ctx, actor, s) =>
      execute(ctx, op("profileComments.restore"), actor, { commentId: s.comments.restore }),
    lost: F,
    banned: F,
  },
};

const TABLES = [
  "threads",
  "posts",
  "post_bodies",
  "report_groups",
  "reports",
  "word_filters",
  "site_settings",
  "awards",
  "member_awards",
  "profile_posts",
  "profile_post_comments",
  "thread_transfers",
  "moderator_log",
  "jobs",
];
const snapshot = (ctx: Ctx) =>
  JSON.stringify(
    TABLES.map((table) => ctx.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
  );

/** The write is refused with exactly this error, and nothing changed. */
async function expectRefused(s: Scenario, attempt: Promise<unknown>, expected: ErrorClass) {
  const before = snapshot(s.elsewhere);
  const error = await attempt.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(expected);
  expect(snapshot(s.elsewhere)).toBe(before);
}

for (const [name, attempt] of Object.entries(attempts)) {
  test(`${name} is refused to a moderator who lost the permission meanwhile`, async () => {
    const s = await scenario();
    try {
      await execute(s.elsewhere, op("permissions.set"), s.founder, {
        groupId: s.staffGroup.id,
        entries: entries(ACTIONS, "unset"),
      });
      await expectRefused(s, attempt.run(s.here, s.actor, s), attempt.lost);
    } finally {
      s.database.close();
    }
  });
  test(`${name} is refused to a moderator banned meanwhile`, async () => {
    const s = await scenario();
    try {
      await execute(s.elsewhere, op("bans.create"), s.founder, {
        userId: s.staff.id,
        reason: "Abuse",
        expiresAt: null,
      });
      await expectRefused(s, attempt.run(s.here, s.actor, s), attempt.banned);
    } finally {
      s.database.close();
    }
  });
  if (attempt.sight)
    test(`${name} answers not found to a moderator who lost sight of the forum meanwhile`, async () => {
      const s = await scenario();
      try {
        await execute(s.elsewhere, op("permissions.set"), s.founder, {
          groupId: s.staffGroup.id,
          nodeId: s.nodeA.id,
          entries: [{ permission: "node.view", value: "never" }],
        });
        await expectRefused(s, attempt.run(s.here, s.actor, s), attempt.sight!);
      } finally {
        s.database.close();
      }
    });
}

/**
 * Runs `change` after the request has read the content and before its write transaction opens:
 * the moment another process can move the content under it.
 */
function beforeWrite(ctx: Ctx, change: () => void) {
  const original = ctx.db.transaction.bind(ctx.db);
  let done = false;
  ctx.db.transaction = ((...args: Parameters<typeof original>) => {
    if (!done) {
      done = true;
      change();
    }
    return original(...args);
  }) as typeof ctx.db.transaction;
}

// The permission is judged on the forum the content is in when the write happens.
test("posts.delete judges the forum the post was moved into meanwhile", async () => {
  const s = await scenario();
  try {
    await execute(s.elsewhere, op("permissions.set"), s.founder, {
      groupId: s.staffGroup.id,
      nodeId: s.nodeB.id,
      entries: [{ permission: "forum.deleteAny", value: "never" }],
    });
    // A thread in the other forum, to which another process moves the post.
    const away = s.threadInB;
    beforeWrite(s.here, () =>
      s.elsewhere.sqlite
        .prepare("UPDATE posts SET thread_id = ?1 WHERE id = ?2")
        .run(away, s.posts.moved),
    );
    await expectRefused(
      s,
      execute(s.here, op("posts.delete"), s.actor, { postId: s.posts.moved }),
      F,
    );
  } finally {
    s.database.close();
  }
});
for (const [name, permission, thread] of [
  ["threads.setLocked", "forum.lock", "lock"],
  ["threads.delete", "forum.deleteAny", "delete"],
  ["threads.setSticky", "forum.stick", "sticky"],
] as const)
  test(`${name} judges the forum the thread was moved into meanwhile`, async () => {
    const s = await scenario();
    try {
      await execute(s.elsewhere, op("permissions.set"), s.founder, {
        groupId: s.staffGroup.id,
        nodeId: s.nodeB.id,
        entries: [{ permission, value: "never" }],
      });
      beforeWrite(s.here, () =>
        s.elsewhere.sqlite
          .prepare("UPDATE threads SET node_id = ?1 WHERE id = ?2")
          .run(s.nodeB.id, s.threads[thread]),
      );
      const input = { threadId: s.threads[thread], isLocked: true, isSticky: true };
      await expectRefused(s, execute(s.here, op(name), s.actor, input), F);
    } finally {
      s.database.close();
    }
  });

test("a moderator who was not revoked still does all of them from a second process", async () => {
  const s = await scenario();
  try {
    for (const attempt of Object.values(attempts)) await attempt.run(s.here, s.actor, s);
  } finally {
    s.database.close();
  }
});
