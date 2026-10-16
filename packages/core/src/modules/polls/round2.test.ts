import { describe, expect, test } from "bun:test";
import { expectNoTableScan, insertUser } from "@sermo/core/testing";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "../../errors";
import { POLL_PURGE_BATCH } from "../../limits";
import { type World, world } from "../feed/fixtures.test";
import { customMember } from "../permissions/group-fixture";
import { readSiteSettings } from "../settings";
import {
  answerIds,
  colours,
  type EditInput,
  type PollValue,
  pollVoteCount,
  withPoll,
} from "./fixtures.test";

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

/** Gives a poll `count` voters at once, as the triggers would see them (one answer each). */
function crowd(w: World, poll: PollValue, count: number): number[] {
  const answers = answerIds(poll);
  const question = poll.questions[0]?.id ?? 0;
  const users = Array.from({ length: count }, () => insertUser(w.ctx).id);
  w.ctx.sqlite.transaction(() => {
    const ballot = w.ctx.sqlite.prepare(
      "INSERT INTO poll_ballots (poll_id, user_id, answered, score, created_at, completed_at) VALUES (?1, ?2, 1, 0, 1, 1)",
    );
    const vote = w.ctx.sqlite.prepare(
      "INSERT INTO poll_votes (poll_id, question_id, answer_id, user_id, created_at) VALUES (?1, ?2, ?3, ?4, 1)",
    );
    users.forEach((user, i) => {
      ballot.run(poll.id, user);
      vote.run(poll.id, question, answers[i % answers.length] ?? 0, user);
    });
  })();
  return users;
}

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
  test("polls.delete takes it out of sight at once and finishes over several calls", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(w, w.alice);
    const members = crowd(w, poll, POLL_PURGE_BATCH * 2 + 500);
    const first = await w.call("polls.delete", w.mod, { pollId: poll.id, reason: "Big" });
    expect(first).toEqual({ ok: true, completed: false });
    // One batch of voters went; the rest wait, and the poll is gone for everyone else.
    expect(rows(w, "SELECT count(*) AS n FROM poll_ballots")).toBe(POLL_PURGE_BATCH + 500);
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
    // The creator cannot finish it (only staff delete a poll that has votes); staff do.
    await expect(w.call("polls.delete", w.alice, { pollId: poll.id })).rejects.toThrow(
      ForbiddenError,
    );
    const second = await w.call("polls.delete", w.mod, { pollId: poll.id, reason: "Big" });
    expect(second.completed).toBe(false);
    const third = await w.call("polls.delete", w.mod, { pollId: poll.id, reason: "Big" });
    expect(third).toEqual({ ok: true, completed: true });
    for (const table of ["polls", "poll_questions", "poll_answers", "poll_votes", "poll_ballots"])
      expect(rows(w, `SELECT count(*) AS n FROM ${table}`)).toBe(0);
    // Every member's counter went down with their ballot, batch by batch.
    expect(members.every((id) => pollVoteCount(w, id) === 0)).toBe(true);
    // The thread can take a new poll.
    await w.call("polls.create", w.alice, { threadId, poll: colours() });
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

  test("a hard delete removes the voters first, batch by batch, and the thread stays until they are down", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(w, w.alice);
    crowd(w, poll, POLL_PURGE_BATCH + 300);
    await w.call("threads.delete", w.mod, { threadId });
    const first = await w.call("threads.hardDelete", w.admin, { threadId, reason: "gone" });
    expect(first).toEqual({ completed: false, removedPosts: 0 });
    expect(rows(w, "SELECT count(*) AS n FROM posts WHERE thread_id = ?1", threadId)).toBe(1);
    expect(rows(w, "SELECT count(*) AS n FROM poll_ballots")).toBe(300);
    const second = await w.call("threads.hardDelete", w.admin, { threadId, reason: "gone" });
    expect(second.completed).toBe(true);
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
