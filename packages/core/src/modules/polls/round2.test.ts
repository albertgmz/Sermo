import { describe, expect, test } from "bun:test";
import { expectNoTableScan } from "@sermo/core/testing";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "../../errors";
import { POLL_PURGE_BATCH } from "../../limits";
import { type World, world } from "../feed/fixtures.test";
import { runDueJobs } from "../jobs";
import { customMember } from "../permissions/group-fixture";
import { purgePollBatch } from "../purge/purge";
import { readSiteSettings } from "../settings";
import {
  answerIds,
  colours,
  crowd,
  type EditInput,
  type PollValue,
  pollVoteCount,
  withPoll,
} from "./fixtures.test";
import { enqueuePollPurge, registerPollJobs } from "./jobs";
import { retirePoll } from "./store";

function configure(w: World, changes: Record<string, unknown>) {
  w.ctx.sqlite
    .prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .run(JSON.stringify({ ...readSiteSettings(w.ctx), ...changes }), w.ctx.now());
}

const edit = (poll: PollValue): EditInput => ({
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
});

const rows = (w: World, sql: string, ...params: number[]) =>
  w.ctx.sqlite.prepare<{ n: number }, number[]>(sql).get(...params)?.n ?? 0;

describe("an editor that started from an older definition", () => {
  test("is refused when an answer was added meanwhile, and nothing is deleted", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, colours({ allowCustom: true }));
    const definition = await w.call("polls.definition", w.alice, { pollId: poll.id });
    await w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "Pink" });
    await expect(
      w.call("polls.update", w.alice, {
        pollId: poll.id,
        poll: edit(poll),
        loadedAt: definition.updatedAt,
      }),
    ).rejects.toThrow(ConflictError);
    expect(rows(w, "SELECT count(*) AS n FROM poll_answers")).toBe(4);
    // Loading again gives the new definition and the edit goes through.
    const fresh = await w.call("polls.definition", w.alice, { pollId: poll.id });
    expect(fresh.updatedAt).not.toBe(definition.updatedAt);
    const input = edit(poll);
    input.questions[0]?.answers.push({ id: fresh.questions[0].answers[3].id, text: "Pink" });
    await w.call("polls.update", w.alice, {
      pollId: poll.id,
      poll: input,
      loadedAt: fresh.updatedAt,
    });
    expect(rows(w, "SELECT count(*) AS n FROM poll_answers")).toBe(4);
  });

  test("a close changes the definition too, a vote does not", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    const loaded = (await w.call("polls.definition", w.alice, { pollId: poll.id })).updatedAt;
    await w.call("polls.vote", w.bob, {
      pollId: poll.id,
      questionId: poll.questions[0]?.id,
      answerIds: [answerIds(poll)[0]],
    });
    await w.call("polls.update", w.alice, { pollId: poll.id, poll: edit(poll), loadedAt: loaded });
    const after = (await w.call("polls.definition", w.alice, { pollId: poll.id })).updatedAt;
    await w.call("polls.close", w.mod, { pollId: poll.id, closed: true });
    await expect(
      w.call("polls.update", w.alice, { pollId: poll.id, poll: edit(poll), loadedAt: after }),
    ).rejects.toThrow(ConflictError);
  });

  test("an update that names no version still goes through (the API's plain call)", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    await w.call("polls.update", w.alice, { pollId: poll.id, poll: edit(poll) });
  });
});

describe("a poll's text is under the rules a post's text is under", () => {
  test("a link from a new member is held, and a poll cannot wait", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, colours({ allowCustom: true }));
    configure(w, { moderateLinksFromNewMembers: true, newMemberDays: 7 });
    const text = "visit https://spam.example now";
    await expect(w.call("polls.addAnswer", w.bob, { pollId: poll.id, text })).rejects.toThrow(
      ValidationError,
    );
    // A new thread is held instead (its poll is part of what is held).
    const held = await w.call("threads.create", w.carol, {
      nodeId: w.open.id,
      title: "T",
      body: "B",
      poll: colours({ questions: [{ text, answers: [{ text: "A" }, { text: "B" }] }] }),
    });
    expect(held.thread.state).toBe("moderated");
    // A member past the new-member days writes it (the thread of a new member is held instead).
    w.ctx.sqlite.prepare("UPDATE users SET created_at = 1 WHERE id = ?1").run(w.bobUser.id);
    const added = await w.call("polls.addAnswer", w.bob, { pollId: poll.id, text });
    expect(added.questions[0].answers.at(-1).text).toBe(text);
  });

  test("a custom answer follows the flood interval", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, colours({ allowCustom: true }));
    configure(w, { floodSeconds: 60 });
    // bob just wrote: he waits.
    const thread = await w.thread(w.bob, w.open.id, "Just wrote");
    expect(thread.thread.id).toBeGreaterThan(0);
    await expect(
      w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "Pink" }),
    ).rejects.toThrow(RateLimitedError);
    w.ctx.clock.advance(61_000);
    await w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "Pink" });
  });

  test("a poll added to a thread later follows it too", async () => {
    const w = world();
    const plain = await w.thread(w.alice, w.open.id, "Plain");
    configure(w, { floodSeconds: 60 });
    await expect(
      w.call("polls.create", w.alice, { threadId: plain.thread.id, poll: colours() }),
    ).rejects.toThrow(RateLimitedError);
    w.ctx.clock.advance(61_000);
    await w.call("polls.create", w.alice, { threadId: plain.thread.id, poll: colours() });
  });
});

describe("a poll with a very large number of voters is removed in bounded batches", () => {
  test("polls.delete takes a big poll out of sight at once and a job removes the voters", async () => {
    const w = world();
    registerPollJobs(w.ctx);
    const { poll, threadId } = await withPoll(w, w.alice);
    const members = crowd(w, poll, POLL_PURGE_BATCH * 2 + 500);
    const first = await w.call("polls.delete", w.mod, { pollId: poll.id, reason: "Big" });
    expect(first).toEqual({ ok: true, completed: false });
    // It answered at once, with nothing removed yet: one job holds the rest of the work.
    expect(rows(w, "SELECT count(*) AS n FROM poll_ballots")).toBe(POLL_PURGE_BATCH * 2 + 500);
    expect(
      rows(w, "SELECT count(*) AS n FROM jobs WHERE type = 'polls.purge' AND status = 'pending'"),
    ).toBe(1);
    expect(await w.call("polls.get", w.bob, { threadId })).toEqual({
      poll: null,
      canCreate: false,
    });
    expect((await w.call("threads.get", w.bob, { threadId })).poll).toEqual({
      exists: false,
      canAdd: false,
    });
    await expect(
      w.call("polls.vote", w.bob, {
        pollId: poll.id,
        questionId: poll.questions[0]?.id,
        answerIds: [answerIds(poll)[0]],
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(w.call("polls.create", w.alice, { threadId, poll: colours() })).rejects.toThrow(
      ConflictError,
    );
    // The creator cannot do it (only staff delete a poll that has votes). A second delete is
    // harmless: no second job, no second log entry.
    await expect(w.call("polls.delete", w.alice, { pollId: poll.id })).rejects.toThrow(
      ForbiddenError,
    );
    const again = await w.call("polls.delete", w.admin, { pollId: poll.id, reason: "Again" });
    expect(again.completed).toBe(false);
    expect(rows(w, "SELECT count(*) AS n FROM jobs WHERE type = 'polls.purge'")).toBe(1);
    expect(rows(w, "SELECT count(*) AS n FROM moderator_log WHERE action = 'poll.delete'")).toBe(1);
    // The job removes the voters, a batch a transaction, and then the poll.
    await runDueJobs(w.ctx);
    for (const table of ["polls", "poll_questions", "poll_answers", "poll_votes", "poll_ballots"])
      expect(rows(w, `SELECT count(*) AS n FROM ${table}`)).toBe(0);
    expect(members.every((id) => pollVoteCount(w, id) === 0)).toBe(true);
    expect(
      rows(w, "SELECT count(*) AS n FROM jobs WHERE type = 'polls.purge' AND status = 'done'"),
    ).toBe(1);
    // The thread can take a new poll.
    await w.call("polls.create", w.alice, { threadId, poll: colours() });
    // A job that comes again for a poll that is gone finds nothing to do.
    enqueuePollPurge(w.ctx, poll.id);
    expect(await runDueJobs(w.ctx)).toBe(1);
    expect(rows(w, "SELECT count(*) AS n FROM polls")).toBe(1);
  }, 60_000);

  test("a batch removes exactly one batch of voters, with their votes, and keeps the counters", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    const members = crowd(w, poll, POLL_PURGE_BATCH * 3 + 10);
    retirePoll(w.ctx, poll.id);
    const left = w.ctx.sqlite.transaction(() => purgePollBatch(w.ctx, poll.id))();
    expect(left).toBe(POLL_PURGE_BATCH * 2 + 10);
    expect(rows(w, "SELECT count(*) AS n FROM poll_ballots")).toBe(POLL_PURGE_BATCH * 2 + 10);
    expect(rows(w, "SELECT count(*) AS n FROM poll_votes")).toBe(POLL_PURGE_BATCH * 2 + 10);
    expect(members.filter((id) => pollVoteCount(w, id) === 0)).toHaveLength(POLL_PURGE_BATCH);
    expect(
      rows(w, "SELECT sum(vote_count) AS n FROM poll_answers WHERE poll_id = ?1", poll.id),
    ).toBe(POLL_PURGE_BATCH * 2 + 10);
  }, 60_000);

  test("a poll of one batch or less is deleted in one call", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    crowd(w, poll, POLL_PURGE_BATCH);
    expect(await w.call("polls.delete", w.mod, { pollId: poll.id })).toEqual({
      ok: true,
      completed: true,
    });
    expect(rows(w, "SELECT count(*) AS n FROM poll_votes")).toBe(0);
  }, 60_000);

  test("a hard delete waits for the job that removes a big poll's voters", async () => {
    const w = world();
    registerPollJobs(w.ctx);
    const { poll, threadId } = await withPoll(w, w.alice);
    crowd(w, poll, POLL_PURGE_BATCH + 300);
    await w.call("threads.delete", w.mod, { threadId });
    const first = await w.call("threads.hardDelete", w.admin, { threadId, reason: "gone" });
    expect(first).toEqual({ completed: false, removedPosts: 0 });
    expect(rows(w, "SELECT count(*) AS n FROM posts WHERE thread_id = ?1", threadId)).toBe(1);
    // Called again before the job ran: nothing more, no second job.
    const second = await w.call("threads.hardDelete", w.admin, { threadId, reason: "gone" });
    expect(second.completed).toBe(false);
    expect(rows(w, "SELECT count(*) AS n FROM jobs WHERE type = 'polls.purge'")).toBe(1);
    await runDueJobs(w.ctx);
    const third = await w.call("threads.hardDelete", w.admin, { threadId, reason: "gone" });
    expect(third.completed).toBe(true);
    for (const table of ["polls", "poll_votes", "poll_ballots"])
      expect(rows(w, `SELECT count(*) AS n FROM ${table}`)).toBe(0);
    expect(rows(w, "SELECT count(*) AS n FROM threads WHERE id = ?1", threadId)).toBe(0);
  }, 60_000);

  test("an author cannot remove such a thread in one step", async () => {
    const w = world();
    const member = customMember(w.ctx, [
      "site.view",
      "node.view",
      "forum.createThread",
      "poll.create",
      "forum.hardDeleteOwn",
    ]);
    const made = await withPoll(w, member.actor, colours(), "Mine");
    crowd(w, made.poll, POLL_PURGE_BATCH + 10);
    await expect(
      w.call("threads.hardDelete", member.actor, { threadId: made.threadId }),
    ).rejects.toThrow(ConflictError);
    expect(rows(w, "SELECT count(*) AS n FROM polls")).toBe(1);
    expect(rows(w, "SELECT count(*) AS n FROM threads WHERE id = ?1", made.threadId)).toBe(1);
  }, 60_000);

  test("an answer chosen by more members than a batch is not removed in one step", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    crowd(w, poll, POLL_PURGE_BATCH * 3 + 3);
    const input = edit(poll);
    // The answers other than the first stay; the first (a third of the crowd) is dropped.
    input.questions[0]!.answers = input.questions[0]!.answers.slice(1);
    await expect(w.call("polls.update", w.mod, { pollId: poll.id, poll: input })).rejects.toThrow(
      ConflictError,
    );
    expect(rows(w, "SELECT count(*) AS n FROM poll_answers")).toBe(3);
  }, 60_000);

  test("its statements seek indexes", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    const json = JSON.stringify([1, 2]);
    expectNoTableScan(
      w.ctx,
      "SELECT user_id FROM poll_ballots WHERE poll_id = ?1 ORDER BY user_id LIMIT ?2",
      [poll.id, POLL_PURGE_BATCH],
    );
    expectNoTableScan(
      w.ctx,
      "DELETE FROM poll_votes WHERE poll_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
      [poll.id, json],
    );
    expectNoTableScan(
      w.ctx,
      "DELETE FROM poll_ballots WHERE poll_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
      [poll.id, json],
    );
    expectNoTableScan(
      w.ctx,
      "SELECT id FROM polls WHERE thread_id IN (SELECT value FROM json_each(?1)) AND ballot_count > ?2 LIMIT 1",
      [json, POLL_PURGE_BATCH],
    );
    expectNoTableScan(
      w.ctx,
      "DELETE FROM poll_ballots WHERE poll_id = ?1 AND user_id IN (SELECT value FROM json_each(?2)) AND NOT EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = ?1 AND v.user_id = poll_ballots.user_id)",
      [poll.id, json],
    );
    expectNoTableScan(
      w.ctx,
      "SELECT action FROM moderator_log WHERE target_type = 'thread' AND target_id = ?1 AND action IN ('poll.close', 'poll.reopen') AND json_extract(details, '$.pollId') = ?2 ORDER BY id DESC LIMIT 1",
      [poll.threadId, poll.id],
    );
  });
});

describe("small things", () => {
  test("the poll tells the screens how long an answer may be", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    expect(poll.answerMaxLength).toBe(100);
  });

  test("a quiz is never anonymous, and the locked-thread refusal says why", async () => {
    const w = world();
    const quiz = await withPoll(
      w,
      w.alice,
      {
        kind: "quiz",
        anonymous: true,
        questions: [{ text: "Q", answers: [{ text: "A", correct: true }, { text: "B" }] }],
      },
      "Quiz",
    );
    expect(quiz.poll.anonymous).toBe(false);
    const plain = await w.thread(w.alice, w.open.id, "Locked");
    await w.call("threads.setLocked", w.mod, { threadId: plain.thread.id, isLocked: true });
    await expect(
      w.call("polls.create", w.alice, { threadId: plain.thread.id, poll: colours() }),
    ).rejects.toThrow("locked");
  });

  test("a text whose words fit but whose tags push it over the raw length is accepted", async () => {
    const w = world();
    const text = `[b]${"x".repeat(100)}[/b]`;
    const { poll } = await withPoll(
      w,
      w.alice,
      colours({ questions: [{ text: "Q", answers: [{ text }, { text: "B" }] }] }),
    );
    expect(poll.questions[0]?.answers[0]?.text).toBe("x".repeat(100));
  });
});
