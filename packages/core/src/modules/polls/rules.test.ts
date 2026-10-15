import { describe, expect, test } from "bun:test";
import { expectNoTableScan, insertNode } from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { dispatchEvents } from "../../events";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { evaluate, loadFacts, membersAffected } from "../../shared/criteria";
import { countStatements, type World, world } from "../feed/fixtures.test";
import { runDueJobs } from "../jobs";
import { customMember, setEntry } from "../permissions/group-fixture";
import { registerPromotionJobs } from "../promotions";
import { getFileRecord } from "../storage";
import {
  answerIds,
  colours,
  counts,
  type EditInput,
  type PollValue,
  pollVoteCount,
  withPoll,
} from "./fixtures.test";
import { pollById, pollSql } from "./store";
import { pollValues } from "./view";

const MEMBERS = 2;

const vote = (w: World, actor: World["alice"], poll: PollValue, answers: number[]) =>
  w.call("polls.vote", actor, {
    pollId: poll.id,
    questionId: poll.questions[0]!.id,
    answerIds: answers,
  });
const table = (w: World, sql: string, ...params: number[]) =>
  w.ctx.sqlite.prepare<{ n: number }, number[]>(sql).get(...params)!.n;
const tableCount = (w: World, name: string) => table(w, `SELECT count(*) AS n FROM ${name}`);
const search = async (w: World, q: string, actor: World["alice"] = w.bob) =>
  (await w.call("search.query", actor, { q })).items.map(
    (item: { thread: { title: string } }) => item.thread.title,
  ) as string[];
const edit = (poll: PollValue, over: Partial<EditInput> = {}): EditInput => ({
  maxChoices: poll.maxChoices,
  allowCustom: poll.allowCustom,
  allowChange: poll.allowChange,
  results: poll.results,
  closesAt: poll.closesAt,
  questions: poll.questions.map((q) => ({
    id: q.id,
    text: q.text,
    answers: q.answers.map((a) => ({ id: a.id, text: a.text })),
  })),
  ...over,
});

/** Inserts an image file the member uploaded and has not attached anywhere. */
function upload(w: World, userId: number, mime = "image/png"): number {
  return Number(
    w.ctx.sqlite
      .prepare(
        "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at) VALUES ('fake', ?1, 4, ?2, 'hash', ?3, 'attachment', 'unattached', ?4)",
      )
      .run(crypto.randomUUID(), mime, userId, w.ctx.now()).lastInsertRowid,
  );
}

describe("thread merges, moves and splits", () => {
  test("the poll of a merged thread moves to a target that has none, votes and all", async () => {
    const w = world();
    const target = await w.thread(w.alice, w.open.id, "Target");
    const source = await withPoll(w, w.bob, colours(), "Source");
    await vote(w, w.carol, source.poll, [answerIds(source.poll)[0]!]);
    await w.call("threads.merge", w.mod, {
      threadId: target.thread.id,
      sourceThreadIds: [source.threadId],
    });
    const moved = (await w.call("polls.get", w.carol, { threadId: target.thread.id })).poll;
    expect(moved.id).toBe(source.poll.id);
    expect(moved.questions[0].answers[0]).toMatchObject({ votes: 1, chosen: true });
    // The one who voted still has voted; the counters did not move.
    expect(pollVoteCount(w, w.carolUser.id)).toBe(1);
    expect(counts(w, moved.id)).toEqual([1, 0, 0]);
    // The old address resolves to the target and the poll is the target's.
    expect((await w.call("threads.get", w.carol, { threadId: source.threadId })).thread.id).toBe(
      target.thread.id,
    );
    await expect(w.call("polls.get", w.carol, { threadId: source.threadId })).rejects.toThrow(
      NotFoundError,
    );
    // The creator's rights follow the poll: bob made it, alice (the target's author) did not.
    expect(moved.permissions.canEdit).toBe(false);
    expect(
      (await w.call("polls.get", w.bob, { threadId: target.thread.id })).poll.permissions.canEdit,
    ).toBe(true);
  });

  test("when the target has a poll, the other stays on the merged thread and is purged with it", async () => {
    const w = world();
    const target = await withPoll(w, w.alice, colours(), "Target");
    const source = await withPoll(w, w.bob, colours(), "Source");
    await vote(w, w.carol, source.poll, [answerIds(source.poll)[0]!]);
    await w.call("threads.merge", w.mod, {
      threadId: target.threadId,
      sourceThreadIds: [source.threadId],
    });
    const kept = (await w.call("polls.get", w.carol, { threadId: target.threadId })).poll;
    expect(kept.id).toBe(target.poll.id);
    expect(tableCount(w, "polls")).toBe(2);
    // The leftover is out of sight: nothing reads a merged-away thread.
    await expect(vote(w, w.bob, source.poll, [answerIds(source.poll)[1]!])).rejects.toThrow(
      NotFoundError,
    );
    // Deleting the target for good takes the tombstone's poll with it.
    await w.call("threads.delete", w.mod, { threadId: target.threadId });
    await w.call("threads.hardDelete", w.admin, { threadId: target.threadId, reason: "gone" });
    expect(tableCount(w, "polls")).toBe(0);
    expect(tableCount(w, "poll_votes")).toBe(0);
    expect(pollVoteCount(w, w.carolUser.id)).toBe(0);
  });

  test("a moved thread keeps its poll and answers to the new forum's permissions", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(w, w.alice);
    await vote(w, w.bob, poll, [answerIds(poll)[0]!]);
    const other = insertNode(w.ctx, { parentId: w.category.id });
    invalidate(w.ctx, "node_tree");
    await w.call("threads.move", w.mod, { threadId, nodeId: other.id });
    const seen = (await w.call("polls.get", w.bob, { threadId })).poll;
    expect(seen.questions[0].answers[0].votes).toBe(1);
    await vote(w, w.carol, poll, [answerIds(poll)[1]!]);
    setEntry(w.ctx, MEMBERS, "poll.vote", -1, other.id);
    await expect(vote(w, w.bob, poll, [answerIds(poll)[2]!])).rejects.toThrow(ForbiddenError);
    expect((await w.call("polls.get", w.bob, { threadId })).poll.permissions.canVote).toBe(false);
    expect(counts(w, poll.id)).toEqual([1, 1, 0]);
  });

  test("a split leaves the poll with the thread it was made for", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(w, w.alice);
    const reply = await w.reply(w.bob, threadId, "A reply to split off");
    const split = await w.call("threads.split", w.mod, {
      threadId,
      postIds: [reply.id],
      title: "Split",
      nodeId: w.open.id,
    });
    expect((await w.call("polls.get", w.bob, { threadId })).poll.id).toBe(poll.id);
    expect((await w.call("polls.get", w.bob, { threadId: split.thread.id })).poll).toBeNull();
  });
});

describe("hiding, deleting for good, batches, erasure", () => {
  test("a deleted thread shows no poll to members, and brings it back when restored", async () => {
    const w = world();
    const { threadId } = await withPoll(w, w.alice);
    await w.call("threads.delete", w.mod, { threadId });
    await expect(w.call("polls.get", w.bob, { threadId })).rejects.toThrow(NotFoundError);
    expect((await w.call("polls.get", w.mod, { threadId })).poll).not.toBeNull();
    await w.call("threads.restore", w.mod, { threadId });
    expect((await w.call("polls.get", w.bob, { threadId })).poll).not.toBeNull();
  });

  test("a thread held for approval carries its poll hidden until it is approved", async () => {
    const w = world();
    await w.call("wordFilters.upsert", w.admin, { term: "heck", action: "moderate" });
    const held = await w.call("threads.create", w.alice, {
      nodeId: w.open.id,
      title: "Held",
      body: "Fine text",
      poll: colours({
        questions: [{ text: "What the heck?", answers: [{ text: "A" }, { text: "B" }] }],
      }),
    });
    expect(held.thread.state).toBe("moderated");
    await expect(w.call("polls.get", w.bob, { threadId: held.thread.id })).rejects.toThrow(
      NotFoundError,
    );
    const own = (await w.call("polls.get", w.alice, { threadId: held.thread.id })).poll;
    expect(own.permissions.canVote).toBe(false);
    await w.call("threads.restore", w.mod, { threadId: held.thread.id });
    expect(
      (await w.call("polls.get", w.bob, { threadId: held.thread.id })).poll.permissions.canVote,
    ).toBe(true);
  });

  test("deleting a thread for good removes the poll, its votes, ballots, pictures and counts", async () => {
    const w = world();
    const picture = upload(w, w.aliceUser.id);
    const { poll, threadId } = await withPoll(
      w,
      w.alice,
      colours({
        questions: [
          {
            text: "Pick",
            imageFileId: picture,
            answers: [{ text: "A" }, { text: "B" }],
          },
        ],
      }),
    );
    await vote(w, w.bob, poll, [answerIds(poll)[0]!]);
    await vote(w, w.carol, poll, [answerIds(poll)[1]!]);
    await w.call("threads.delete", w.mod, { threadId });
    await w.call("threads.hardDelete", w.admin, { threadId, reason: "gone" });
    for (const name of ["polls", "poll_questions", "poll_answers", "poll_votes", "poll_ballots"])
      expect(tableCount(w, name)).toBe(0);
    expect(table(w, "SELECT count(*) AS n FROM attachments WHERE content_type = 'poll'")).toBe(0);
    expect(pollVoteCount(w, w.bobUser.id)).toBe(0);
    expect(pollVoteCount(w, w.carolUser.id)).toBe(0);
    // The picture is private now and queued for deletion from storage.
    expect(w.ctx.sqlite.prepare("SELECT visibility FROM files WHERE id = ?1").get(picture)).toEqual(
      { visibility: "private" },
    );
    expect(table(w, "SELECT count(*) AS n FROM jobs WHERE type = 'storage.deletePermanent'")).toBe(
      1,
    );
    // The poll is gone from search too.
    expect(await search(w, "Pick")).toEqual([]);
  });

  test("batch delete, restore and move leave polls and votes as they are", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(w, w.alice);
    await vote(w, w.bob, poll, [answerIds(poll)[0]!]);
    const other = insertNode(w.ctx, { parentId: w.category.id });
    invalidate(w.ctx, "node_tree");
    for (const update of [
      { action: "delete" },
      { action: "restore" },
      { action: "move", nodeId: other.id },
      { action: "lock" },
    ])
      await w.call("threads.batchUpdate", w.admin, { threadIds: [threadId], update });
    const seen = (await w.call("polls.get", w.bob, { threadId })).poll;
    expect(seen.questions[0].answers[0].votes).toBe(1);
    expect(pollVoteCount(w, w.bobUser.id)).toBe(1);
    expect(counts(w, poll.id)).toEqual([1, 0, 0]);
  });
});

describe("a member who is erased", () => {
  test("their votes stay with their content, under the name the account has now", async () => {
    const { accounts, PASSWORD } = await import("../admin/fixtures.test");
    const w = await accounts();
    const founder = await w.register("Founder", 4);
    const author = await w.register("Author");
    const voter = await w.register("Voter");
    const other = await w.register("Other");
    const node = insertNode(w.ctx, { title: "Forum", type: "forum" });
    invalidate(w.ctx, "node_tree");
    const created = await w.run("threads.create", author.actor, {
      nodeId: node.id,
      title: "Poll",
      body: "Vote",
      poll: colours({ results: "always" }),
    });
    const { poll } = await w.run("polls.get", author.actor, { threadId: created.thread.id });
    const red = poll.questions[0].answers[0].id;
    for (const member of [voter, other])
      await w.run("polls.vote", member.actor, {
        pollId: poll.id,
        questionId: poll.questions[0].id,
        answerIds: [red],
      });
    await w.run("users.adminErase", founder.actor, {
      userId: voter.id,
      actorPassword: PASSWORD,
      reason: "Asked",
    });
    const after = (await w.run("polls.get", other.actor, { threadId: created.thread.id })).poll;
    expect(after.questions[0].answers[0].votes).toBe(2);
    const voters = await w.run("polls.voters", other.actor, { pollId: poll.id, answerId: red });
    expect(
      voters.items.map((item: { user: { username: string } }) => item.user.username).sort(),
    ).toEqual([`Deleted member ${voter.id}`, "Other"].sort());
    // An erased member cannot vote any more, and the counts do not change.
    await expect(
      w.run("polls.vote", voter.actor, {
        pollId: poll.id,
        questionId: poll.questions[0].id,
        answerIds: [poll.questions[0].answers[1].id],
      }),
    ).rejects.toThrow();
    expect(
      w.ctx.sqlite.prepare("SELECT vote_count FROM poll_answers WHERE id = ?1").get(red),
    ).toEqual({ vote_count: 2 });
  });
});

describe("the criterion: polls voted in", () => {
  const rule = {
    match: "all" as const,
    conditions: [{ criterion: "polls_voted_at_least", value: 2 }],
  };
  const holds = (w: World, userId: number) =>
    evaluate(rule, loadFacts(w.ctx, [userId], [rule]).get(userId)!);

  test("a counter on the member: a poll and a quiz count once each, a change of vote never", async () => {
    const w = world();
    const first = await withPoll(w, w.alice, colours(), "One");
    const second = await withPoll(w, w.alice, colours(), "Two");
    const quiz = await withPoll(
      w,
      w.alice,
      {
        kind: "quiz",
        questions: [{ text: "Q", answers: [{ text: "A", correct: true }, { text: "B" }] }],
      },
      "Three",
    );
    await vote(w, w.bob, first.poll, [answerIds(first.poll)[0]!]);
    await vote(w, w.bob, first.poll, [answerIds(first.poll)[1]!]);
    expect(holds(w, w.bobUser.id)).toBe(false);
    await vote(w, w.bob, second.poll, [answerIds(second.poll)[0]!]);
    expect(holds(w, w.bobUser.id)).toBe(true);
    await vote(w, w.carol, quiz.poll, [answerIds(quiz.poll)[0]!]);
    expect(pollVoteCount(w, w.carolUser.id)).toBe(1);
    expect(pollVoteCount(w, w.bobUser.id)).toBe(2);
    // The poll deleted for good takes the count with it.
    await w.call("polls.delete", w.mod, { pollId: second.poll.id });
    expect(holds(w, w.bobUser.id)).toBe(false);
  });

  test("a promotion that asks for it is refreshed by the vote, not by a scan", async () => {
    const w = world();
    const group = w.ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Voters', 25) RETURNING id",
      )
      .get()!.id;
    await w.call("promotions.create", w.admin, { title: "Voters", rule, groupIds: [group] });
    registerPromotionJobs(w.ctx);
    const one = await withPoll(w, w.alice, colours(), "One");
    const two = await withPoll(w, w.alice, colours(), "Two");
    const grants = () =>
      table(w, "SELECT count(*) AS n FROM user_group_grants WHERE user_id = ?1", w.bobUser.id);
    await vote(w, w.bob, one.poll, [answerIds(one.poll)[0]!]);
    await dispatchEvents(w.ctx);
    expect(grants()).toBe(0);
    await vote(w, w.bob, two.poll, [answerIds(two.poll)[0]!]);
    await dispatchEvents(w.ctx);
    expect(grants()).toBe(1);
    // Only a first vote is news.
    const events = () =>
      table(w, "SELECT count(*) AS n FROM domain_events WHERE type = 'poll.voted'");
    expect(events()).toBe(2);
    await vote(w, w.bob, two.poll, [answerIds(two.poll)[1]!]);
    expect(events()).toBe(2);
    expect(
      membersAffected(
        w.ctx,
        {
          id: 1,
          type: "poll.voted",
          targetType: "user",
          targetId: w.bobUser.id,
          payload: {},
          createdAt: 0,
        },
        [rule],
      ),
    ).toEqual([w.bobUser.id]);
  });

  test("its facts are read from the member's row", () => {
    const w = world();
    const plan = w.ctx.sqlite
      .prepare<{ detail: string }, []>(
        "EXPLAIN QUERY PLAN SELECT u.poll_vote_count FROM users u WHERE u.id IN (SELECT value FROM json_each('[1]'))",
      )
      .all();
    expect(plan.map((row) => row.detail).join("\n")).not.toContain("SCAN u");
  });
});

describe("search", () => {
  test("the question is searchable with the thread, through every change of it", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(
      w,
      w.alice,
      colours({
        questions: [{ text: "Which zeppelin?", answers: [{ text: "A" }, { text: "B" }] }],
      }),
      "Airships",
    );
    expect(await search(w, "zeppelin")).toEqual(["Airships"]);
    // Answers are not indexed; only the question.
    expect(await search(w, "Which")).toEqual(["Airships"]);
    // The post and the title can change without losing it.
    await w
      .call("posts.update", w.alice, {
        postId: (await w.call("threads.get", w.alice, { threadId })).thread.firstPostId ?? 0,
        body: "A new opening",
      })
      .catch(() => undefined);
    await w.call("threads.update", w.alice, { threadId, title: "Airships and more" });
    expect(await search(w, "zeppelin")).toEqual(["Airships and more"]);
    // The question changes: the old word goes, the new one comes.
    const input = edit(poll);
    input.questions[0]!.text = "Which dirigible?";
    await w.call("polls.update", w.alice, { pollId: poll.id, poll: input });
    expect(await search(w, "zeppelin")).toEqual([]);
    expect(await search(w, "dirigible")).toEqual(["Airships and more"]);
    // Closed to a viewer who may not read the thread: no hit, no leak.
    setEntry(w.ctx, MEMBERS, "forum.viewContent", -1, w.open.id);
    expect(await search(w, "dirigible", w.carol)).toEqual([]);
    setEntry(w.ctx, MEMBERS, "forum.viewContent", 0, w.open.id);
    // Deleting the poll takes it out of the index.
    await w.call("polls.delete", w.alice, { pollId: poll.id });
    expect(await search(w, "dirigible")).toEqual([]);
    expect(await search(w, "Airships")).toEqual(["Airships and more"]);
  });

  test("a poll added later is indexed, and follows a merge", async () => {
    const w = world();
    const plain = await w.thread(w.alice, w.open.id, "Plain thread");
    await w.call("polls.create", w.alice, {
      threadId: plain.thread.id,
      poll: colours({
        questions: [{ text: "Which blimp?", answers: [{ text: "A" }, { text: "B" }] }],
      }),
    });
    expect(await search(w, "blimp")).toEqual(["Plain thread"]);
    const target = await w.thread(w.bob, w.open.id, "Target thread");
    await w.call("threads.merge", w.mod, {
      threadId: target.thread.id,
      sourceThreadIds: [plain.thread.id],
    });
    expect(await search(w, "blimp")).toEqual(["Target thread"]);
  });
});

describe("anonymous polls", () => {
  async function anonymous() {
    const w = world();
    const made = await withPoll(w, w.alice, colours({ anonymous: true }));
    const red = answerIds(made.poll)[0]!;
    await vote(w, w.bob, made.poll, [red]);
    await vote(w, w.carol, made.poll, [red]);
    return { w, ...made, red };
  }

  test("nobody lists the voters, staff and the creator included", async () => {
    const { w, poll, red } = await anonymous();
    for (const actor of [w.alice, w.bob, w.mod, w.admin])
      await expect(
        w.call("polls.voters", actor, { pollId: poll.id, answerId: red }),
      ).rejects.toThrow(ForbiddenError);
    for (const actor of [w.alice, w.bob, w.mod, w.admin, GUEST]) {
      const seen = (await w.call("polls.get", actor, { threadId: poll.threadId })).poll;
      expect(seen.permissions.canViewVoters).toBe(false);
      expect(seen.anonymous).toBe(true);
    }
    // Counts are shown; who is not.
    const counted = (await w.call("polls.get", w.admin, { threadId: poll.threadId })).poll;
    expect(counted.questions[0].answers[0].votes).toBe(2);
    // A group that holds every permission there is still gets no list.
    const all = customMember(w.ctx, [
      "site.view",
      "node.view",
      "poll.viewVoters",
      "poll.manage",
      "poll.vote",
    ]);
    await expect(
      w.call("polls.voters", all.actor, { pollId: poll.id, answerId: red }),
    ).rejects.toThrow(ForbiddenError);
  });

  test("the editor's view, an edit and the log carry no voter either", async () => {
    const { w, poll } = await anonymous();
    const definition = await w.call("polls.definition", w.mod, { pollId: poll.id });
    const names = [w.bobUser, w.carolUser];
    const dump = JSON.stringify(definition);
    for (const user of names) {
      expect(dump).not.toContain(user.username);
      expect(dump).not.toContain(`"userId":${user.id}`);
    }
    // Staff do everything a poll allows, then the whole log is read for voters.
    await w.call("polls.update", w.mod, { pollId: poll.id, poll: edit(poll), reason: "Tidy" });
    await w.call("polls.close", w.mod, { pollId: poll.id, closed: true, reason: "Done" });
    await w.call("polls.close", w.mod, { pollId: poll.id, closed: false });
    await w.call("polls.delete", w.admin, { pollId: poll.id, reason: "Gone" });
    const log = w.ctx.sqlite
      .prepare<{ details: string; reason: string }, []>(
        "SELECT details, reason FROM moderator_log WHERE action LIKE 'poll.%'",
      )
      .all();
    expect(log).toHaveLength(4);
    const everything = JSON.stringify(log);
    for (const user of names) {
      expect(everything).not.toContain(user.username);
      expect(everything).not.toMatch(new RegExp(`"(user|voter|member)(Id|s)?":\\[?${user.id}\\b`));
    }
    // The event log is never purged: what it holds names a member and no poll.
    const events = w.ctx.sqlite
      .prepare<{ target_type: string; payload: string }, []>(
        "SELECT target_type, payload FROM domain_events WHERE type = 'poll.voted'",
      )
      .all();
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.target_type).toBe("user");
      expect(event.payload).toBe("{}");
    }
    expect(
      w.ctx.sqlite
        .prepare("SELECT count(*) AS n FROM domain_events WHERE target_type = 'poll'")
        .get(),
    ).toEqual({ n: 0 });
    // The log of the moderators, as moderators read it.
    const listed = JSON.stringify(await w.call("moderatorLog.list", w.admin, { limit: 50 }));
    for (const user of names) expect(listed).not.toContain(user.username);
  });

  test("the choice of anonymity is made once: a poll cannot be turned public", async () => {
    const { w, poll } = await anonymous();
    const input = { ...edit(poll), anonymous: false, kind: "quiz" };
    const same = await w.call("polls.update", w.alice, { pollId: poll.id, poll: input });
    expect(same).toMatchObject({ anonymous: true, kind: "poll" });
    const red = answerIds(poll)[0]!;
    await expect(
      w.call("polls.voters", w.admin, { pollId: poll.id, answerId: red }),
    ).rejects.toThrow(ForbiddenError);
  });

  test("a public poll's voters are unaffected", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    const red = answerIds(poll)[0]!;
    await vote(w, w.bob, poll, [red]);
    expect(
      (await w.call("polls.voters", w.alice, { pollId: poll.id, answerId: red })).items,
    ).toHaveLength(1);
  });
});

describe("pictures", () => {
  const withPictures = (picture: number, second: number) =>
    colours({
      questions: [
        {
          text: "Which one?",
          imageFileId: picture,
          answers: [{ text: "A", imageFileId: second }, { text: "B" }],
        },
      ],
    });

  test("attached to the poll, shown to whoever may read the thread, nobody else", async () => {
    const w = world();
    const one = upload(w, w.aliceUser.id);
    const two = upload(w, w.aliceUser.id);
    const { poll, threadId } = await withPoll(w, w.alice, withPictures(one, two));
    expect(poll.questions[0]!.image).toMatchObject({ fileId: one, url: `/api/v1/files/${one}` });
    expect(poll.questions[0]!.answers[0]!.image).toMatchObject({ fileId: two });
    expect(poll.questions[0]!.answers[1]!.image).toBeNull();
    expect(table(w, "SELECT count(*) AS n FROM attachments WHERE content_type = 'poll'")).toBe(2);
    // Readable as the thread is.
    for (const actor of [w.bob, GUEST, w.alice, w.mod])
      expect(getFileRecord(w.ctx, actor, one).id).toBe(one);
    setEntry(w.ctx, MEMBERS, "forum.viewContent", -1, w.open.id);
    expect(() => getFileRecord(w.ctx, w.bob, one)).toThrow(NotFoundError);
    expect(getFileRecord(w.ctx, w.alice, one).id).toBe(one);
    setEntry(w.ctx, MEMBERS, "forum.viewContent", 0, w.open.id);
    await w.call("threads.delete", w.mod, { threadId });
    expect(() => getFileRecord(w.ctx, w.bob, one)).toThrow(NotFoundError);
    expect(getFileRecord(w.ctx, w.mod, one).id).toBe(one);
  });

  test("only images, only the member's own unattached files, each used once", async () => {
    const w = world();
    const make = (poll: object, actor = w.alice) =>
      w.call("threads.create", actor, { nodeId: w.open.id, title: "T", body: "B", poll });
    const mine = upload(w, w.aliceUser.id);
    const pdf = upload(w, w.aliceUser.id, "application/pdf");
    const bobs = upload(w, w.bobUser.id);
    await expect(make(withPictures(mine, pdf))).rejects.toThrow(ValidationError);
    await expect(make(withPictures(mine, bobs))).rejects.toThrow(NotFoundError);
    await expect(make(withPictures(mine, mine))).rejects.toThrow(ValidationError);
    await expect(make(withPictures(mine, 999_999))).rejects.toThrow(NotFoundError);
    // Nothing was kept by the refused ones.
    expect(tableCount(w, "polls")).toBe(0);
    expect(w.ctx.sqlite.prepare("SELECT visibility FROM files WHERE id = ?1").get(mine)).toEqual({
      visibility: "unattached",
    });
    const fine = upload(w, w.aliceUser.id);
    await make(withPictures(mine, fine));
    // A file now in use cannot go into another poll.
    await expect(make(withPictures(mine, upload(w, w.aliceUser.id)))).rejects.toThrow(
      NotFoundError,
    );
  });

  test("a member who may not upload attachments cannot add pictures", async () => {
    const w = world();
    setEntry(w.ctx, MEMBERS, "forum.uploadAttachments", -1, w.open.id);
    const mine = upload(w, w.aliceUser.id);
    await expect(
      w.call("threads.create", w.alice, {
        nodeId: w.open.id,
        title: "T",
        body: "B",
        poll: withPictures(mine, upload(w, w.aliceUser.id)),
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  test("editing keeps, swaps and removes pictures; the removed one goes to storage", async () => {
    const w = world();
    const one = upload(w, w.aliceUser.id);
    const two = upload(w, w.aliceUser.id);
    const { poll } = await withPoll(w, w.alice, withPictures(one, two));
    const input = (imageFileId: number | null, answerFile: number | null) => ({
      ...edit(poll),
      questions: [
        {
          id: poll.questions[0]!.id,
          text: "Which one?",
          imageFileId,
          answers: poll.questions[0]!.answers.map((a, i) => ({
            id: a.id,
            text: a.text,
            imageFileId: i === 0 ? answerFile : null,
          })),
        },
      ],
    });
    // The question keeps its picture, the answer loses its own.
    const kept = await w.call("polls.update", w.alice, { pollId: poll.id, poll: input(one, null) });
    expect(kept.questions[0].image.fileId).toBe(one);
    expect(kept.questions[0].answers[0].image).toBeNull();
    expect(w.ctx.sqlite.prepare("SELECT visibility FROM files WHERE id = ?1").get(two)).toEqual({
      visibility: "private",
    });
    expect(table(w, "SELECT count(*) AS n FROM jobs WHERE type = 'storage.deletePermanent'")).toBe(
      1,
    );
    // A new picture takes the question's place; staff may add theirs.
    const staffs = upload(w, actorUserId(w.mod)!);
    const swapped = await w.call("polls.update", w.mod, {
      pollId: poll.id,
      poll: input(staffs, null),
    });
    expect(swapped.questions[0].image.fileId).toBe(staffs);
    runDueJobs; // the storage job is not run here: the file stays until it is
  });
});

describe("no query per item", () => {
  test("a poll costs the same statements whatever its size", async () => {
    const w = world();
    const small = await withPoll(w, w.alice, colours(), "Small");
    const many = Array.from({ length: 20 }, (_, i) => ({
      text: `Question ${i}`,
      explanation: "Because",
      answers: Array.from({ length: 8 }, (_, a) => ({ text: `Answer ${a}`, correct: a === 0 })),
    }));
    const big = await withPoll(w, w.alice, { kind: "quiz", questions: many }, "Big");
    for (const poll of [small.poll, big.poll])
      await vote(w, w.bob, poll, [poll.questions[0]!.answers[0]!.id]);
    const cost = (threadId: number) =>
      countStatements(w.ctx, () => w.call("polls.get", w.bob, { threadId }));
    expect(await cost(big.threadId)).toBe(await cost(small.threadId));
  });

  test("a page of polls is read in the same statements as one", async () => {
    const w = world();
    const made: { threadId: number; poll: PollValue }[] = [];
    for (let i = 0; i < 8; i++) made.push(await withPoll(w, w.alice, colours(), `Poll ${i}`));
    for (const { poll } of made) await vote(w, w.bob, poll, [poll.questions[0]!.answers[0]!.id]);
    const cost = (count: number) => {
      const rows = made.slice(0, count).map((m) => pollById(w.ctx, m.poll.id)!);
      const threads = new Map(
        made.slice(0, count).map((m) => [
          m.threadId,
          {
            id: m.threadId,
            node_id: w.open.id,
            user_id: w.aliceUser.id,
            is_locked: 0,
            state: "visible",
          },
        ]),
      );
      return countStatements(w.ctx, async () => {
        pollValues(w.ctx, w.bob, rows, threads);
      });
    };
    expect(await cost(8)).toBe(await cost(1));
  });
});

describe("query plans", () => {
  test("every read and write of a poll seeks an index", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    const json = JSON.stringify([poll.id]);
    const answer = poll.questions[0]!.answers[0]!.id;
    const user = w.bobUser.id;
    const allow = { allowTempBTree: true };
    expectNoTableScan(w.ctx, pollSql.byId, [poll.id]);
    expectNoTableScan(w.ctx, pollSql.byThread, [poll.threadId]);
    expectNoTableScan(w.ctx, pollSql.questions, [json], allow);
    expectNoTableScan(w.ctx, pollSql.answers, [json], allow);
    expectNoTableScan(w.ctx, pollSql.myVotes, [json, user]);
    expectNoTableScan(w.ctx, pollSql.myBallots, [json, user]);
    expectNoTableScan(w.ctx, pollSql.voters, [answer, 0, 20]);
    expectNoTableScan(w.ctx, pollSql.votesOfMember, [poll.id, user]);
    const statements: [string, unknown[]][] = [
      ["DELETE FROM poll_votes WHERE poll_id IN (SELECT value FROM json_each(?1))", [json]],
      ["DELETE FROM poll_ballots WHERE poll_id IN (SELECT value FROM json_each(?1))", [json]],
      ["DELETE FROM poll_answers WHERE poll_id IN (SELECT value FROM json_each(?1))", [json]],
      ["DELETE FROM poll_questions WHERE poll_id IN (SELECT value FROM json_each(?1))", [json]],
      ["DELETE FROM poll_votes WHERE answer_id IN (SELECT value FROM json_each(?1))", [json]],
      ["SELECT id FROM polls WHERE thread_id = ?1", [poll.threadId]],
      ["SELECT answered FROM poll_ballots WHERE poll_id = ?1 AND user_id = ?2", [poll.id, user]],
      [
        "SELECT 1 AS found FROM poll_votes WHERE poll_id = ?1 AND user_id = ?2 AND question_id = ?3 LIMIT 1",
        [poll.id, user, poll.questions[0]!.id],
      ],
      [
        "SELECT id, is_correct FROM poll_answers WHERE poll_id = ?1 AND question_id = ?2",
        [poll.id, poll.questions[0]!.id],
      ],
      [
        "UPDATE polls SET thread_id = ?2 WHERE thread_id = ?1 AND NOT EXISTS (SELECT 1 FROM polls WHERE thread_id = ?2)",
        [poll.threadId, 0],
      ],
    ];
    for (const [sql, params] of statements) expectNoTableScan(w.ctx, sql, params);
  });

  test("the search triggers seek the poll of a thread", () => {
    const w = world();
    const plans = [
      "SELECT char(10) || pl.search_text FROM posts p JOIN threads t ON t.id = p.thread_id AND t.first_post_id = p.id JOIN polls pl ON pl.thread_id = t.id WHERE p.id = 1 AND pl.search_text != ''",
      "SELECT char(10) || pl.search_text FROM polls pl WHERE pl.thread_id = 1 AND pl.search_text != ''",
    ];
    for (const sql of plans) expectNoTableScan(w.ctx, sql);
  });
});

describe("votes under concurrency", () => {
  test("a vote refused for a member whose permission was taken away elsewhere meanwhile", async () => {
    const w = world();
    const member = customMember(w.ctx, ["site.view", "node.view", "poll.vote"]);
    const { poll } = await withPoll(w, w.alice);
    const database = sharedDatabase(w.ctx);
    try {
      const here = database.open();
      const elsewhere = database.open();
      const actor = resolvedActor(here, member.row.id);
      // Warm: this process has resolved the member and holds what they may do.
      await (await import("../../operation")).execute(
        here,
        (await import("../../operations")).getOperation("polls.get"),
        actor,
        { threadId: poll.threadId },
      );
      setEntry(elsewhere, member.groupId, "poll.vote", 0);
      await expect(
        (await import("../../operation")).execute(
          here,
          (await import("../../operations")).getOperation("polls.vote"),
          actor,
          {
            pollId: poll.id,
            questionId: poll.questions[0]!.id,
            answerIds: [poll.questions[0]!.answers[0]!.id],
          },
        ),
      ).rejects.toThrow(ForbiddenError);
      expect(elsewhere.sqlite.prepare("SELECT count(*) AS n FROM poll_votes").get()).toEqual({
        n: 0,
      });
    } finally {
      database.close();
    }
  });

  test("members voting from three processes at once leave every counter exact", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, colours({ maxChoices: 1 }));
    const members = Array.from({ length: 12 }, (_, i) => {
      const row = customMember(w.ctx, ["site.view", "node.view", "poll.vote"]).row;
      return row.id + i * 0;
    });
    const database = sharedDatabase(w.ctx);
    try {
      const file = (database.open().sqlite.query("PRAGMA database_list").get() as { file: string })
        .file;
      const script = new URL("./vote-process.ts", import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        "$1",
      );
      const ids = answerIds(poll);
      const run = (slice: number[]) =>
        Bun.spawn(
          [
            process.execPath,
            script,
            file,
            String(poll.id),
            String(poll.questions[0]!.id),
            JSON.stringify(ids),
            JSON.stringify(slice),
            "6",
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
      const processes = [0, 1, 2].map((p) => run(members.filter((_, i) => i % 3 === p)));
      const outputs = await Promise.all(
        processes.map(async (child) => ({
          code: await child.exited,
          out: await new Response(child.stdout).text(),
          err: await new Response(child.stderr).text(),
        })),
      );
      for (const output of outputs)
        expect({ ...output, out: output.out.trim() }).toMatchObject({ code: 0 });
      const db = database.open().sqlite;
      const perAnswer = db
        .prepare<{ id: number; vote_count: number; n: number }, []>(
          "SELECT a.id, a.vote_count, (SELECT count(*) FROM poll_votes v WHERE v.answer_id = a.id) AS n FROM poll_answers a ORDER BY a.id",
        )
        .all();
      for (const row of perAnswer) expect(row.vote_count).toBe(row.n);
      // One vote a member, a single ballot each, whatever the order of the changes.
      expect(perAnswer.reduce((sum, row) => sum + row.n, 0)).toBe(members.length);
      expect(db.prepare("SELECT ballot_count FROM polls").get()).toEqual({
        ballot_count: members.length,
      });
      expect(db.prepare("SELECT count(*) AS n FROM poll_ballots").get()).toEqual({
        n: members.length,
      });
      expect(db.prepare("SELECT count(*) AS n FROM users WHERE poll_vote_count = 1").get()).toEqual(
        { n: members.length },
      );
    } finally {
      database.close();
    }
  }, 60_000);
});

describe("the counters always agree with a recount", () => {
  test("after a long mixed run of votes, changes, edits, closes and deletes", async () => {
    const w = world();
    let seed = 12345;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const actors = [w.alice, w.bob, w.carol, w.mod, w.admin];
    const polls: PollValue[] = [];
    for (let i = 0; i < 3; i++)
      polls.push(
        (await withPoll(w, w.alice, colours({ maxChoices: 2, allowCustom: true }), `P${i}`)).poll,
      );
    const quiz = (
      await withPoll(
        w,
        w.alice,
        {
          kind: "quiz",
          questions: [
            { text: "A?", answers: [{ text: "Y", correct: true }, { text: "N" }] },
            { text: "B?", answers: [{ text: "Y", correct: true }, { text: "N" }] },
          ],
        },
        "Q",
      )
    ).poll;
    for (let step = 0; step < 160; step++) {
      const actor = actors[random(actors.length)]!;
      const target = polls[random(polls.length)]!;
      const kind = random(10);
      const fresh = async (poll: PollValue) =>
        (await w.call("polls.get", w.admin, { threadId: poll.threadId })).poll as PollValue | null;
      try {
        if (kind < 5) {
          const now = await fresh(target);
          if (!now) continue;
          const pick = now.questions[0]!.answers.map((a) => a.id);
          const count = 1 + random(2);
          const chosen = [
            ...new Set(Array.from({ length: count }, () => pick[random(pick.length)]!)),
          ];
          await w.call("polls.vote", actor, {
            pollId: target.id,
            questionId: target.questions[0]!.id,
            answerIds: chosen,
          });
        } else if (kind === 5) {
          await w.call("polls.addAnswer", actor, { pollId: target.id, text: `Mine ${step}` });
        } else if (kind === 6) {
          const now = await fresh(target);
          if (now && now.questions[0]!.answers.length > 2)
            await w.call("polls.update", w.mod, {
              pollId: target.id,
              poll: edit(now, {
                questions: [
                  {
                    id: now.questions[0]!.id,
                    text: now.questions[0]!.text,
                    answers: now.questions[0]!.answers.slice(random(2) ? 1 : 0).map((a) => ({
                      id: a.id,
                      text: a.text,
                    })),
                  },
                ],
              }),
            });
        } else if (kind === 7) {
          await w.call("polls.close", w.mod, { pollId: target.id, closed: random(2) === 0 });
        } else if (kind === 8) {
          const q = quiz.questions[random(2)]!;
          await w.call("polls.vote", actor, {
            pollId: quiz.id,
            questionId: q.id,
            answerIds: [q.answers[random(2)]!.id],
          });
        } else if (random(8) === 0) {
          await w.call("polls.delete", w.admin, { pollId: target.id });
          polls.splice(polls.indexOf(target), 1);
          polls.push(
            (await withPoll(w, w.alice, colours({ maxChoices: 2, allowCustom: true }), `R${step}`))
              .poll,
          );
        }
      } catch (error) {
        // Refusals (a closed poll, a repeated answer, an answer already taken) are part of the run.
        if (!(error instanceof Error) || error.name === "TypeError") throw error;
      }
    }
    const sql = w.ctx.sqlite;
    expect(
      sql
        .prepare(
          "SELECT count(*) AS n FROM poll_answers a WHERE a.vote_count != (SELECT count(*) FROM poll_votes v WHERE v.answer_id = a.id)",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(
      sql
        .prepare(
          "SELECT count(*) AS n FROM polls p WHERE p.ballot_count != (SELECT count(*) FROM poll_ballots b WHERE b.poll_id = p.id)",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(
      sql
        .prepare(
          "SELECT count(*) AS n FROM users u WHERE u.poll_vote_count != (SELECT count(*) FROM poll_ballots b WHERE b.user_id = u.id)",
        )
        .get(),
    ).toEqual({ n: 0 });
    // A ballot is a member with a vote in the poll, and the other way round.
    expect(
      sql
        .prepare(
          "SELECT count(*) AS n FROM poll_ballots b WHERE NOT EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = b.poll_id AND v.user_id = b.user_id)",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(
      sql
        .prepare(
          "SELECT count(*) AS n FROM (SELECT DISTINCT poll_id, user_id FROM poll_votes) v WHERE NOT EXISTS (SELECT 1 FROM poll_ballots b WHERE b.poll_id = v.poll_id AND b.user_id = v.user_id)",
        )
        .get(),
    ).toEqual({ n: 0 });
    // The quiz score is the right answers the member gave.
    expect(
      sql
        .prepare(
          "SELECT count(*) AS n FROM poll_ballots b WHERE b.poll_id = ?1 AND b.score != (SELECT count(*) FROM poll_votes v JOIN poll_answers a ON a.id = v.answer_id WHERE v.poll_id = b.poll_id AND v.user_id = b.user_id AND a.is_correct = 1)",
        )
        .get(quiz.id),
    ).toEqual({ n: 0 });
    expect(
      sql
        .prepare(
          "SELECT count(*) AS n FROM poll_ballots b WHERE b.poll_id = ?1 AND b.answered != (SELECT count(*) FROM poll_votes v WHERE v.poll_id = b.poll_id AND v.user_id = b.user_id)",
        )
        .get(quiz.id),
    ).toEqual({ n: 0 });
  }, 60_000);
});

describe("seo", () => {
  test("neither the question nor a count is in a thread's metadata", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(
      w,
      w.alice,
      colours({
        questions: [
          { text: "Which unique-question-word?", answers: [{ text: "A" }, { text: "B" }] },
        ],
      }),
    );
    await vote(w, w.bob, poll, [answerIds(poll)[0]!]);
    const seo = JSON.stringify(await w.call("seo.thread", GUEST, { threadId }));
    expect(seo).not.toContain("unique-question-word");
    const thread = JSON.stringify(await w.call("threads.get", GUEST, { threadId }));
    expect(thread).not.toContain("unique-question-word");
  });
});
