import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "../../errors";
import { type World, world } from "../feed/fixtures.test";
import { answerIds, colours, type EditInput, type PollValue, withPoll } from "./fixtures.test";

const vote = (w: World, actor: World["alice"], poll: PollValue, answers: number[]) =>
  w.call("polls.vote", actor, {
    pollId: poll.id,
    questionId: poll.questions[0]?.id,
    answerIds: answers,
  });

const edit = (poll: PollValue, text: (old: string) => string): EditInput => ({
  maxChoices: poll.maxChoices,
  allowCustom: poll.allowCustom,
  allowChange: poll.allowChange,
  results: poll.results,
  closesAt: poll.closesAt,
  questions: poll.questions.map((q) => ({
    id: q.id,
    text: q.text,
    answers: q.answers.map((a) => ({ id: a.id, text: text(a.text) })),
  })),
});

describe("a poll is written content: the forum's posting rules hold", () => {
  test("a read-only forum takes no new poll and no custom answer, but still votes", async () => {
    const w = world();
    const polled = await withPoll(w, w.alice, colours({ allowCustom: true }), "Open");
    const plain = await w.thread(w.alice, w.open.id, "Plain");
    w.ctx.sqlite.prepare("UPDATE nodes SET is_read_only = 1 WHERE id = ?1").run(w.open.id);
    await expect(
      w.call("polls.create", w.alice, { threadId: plain.thread.id, poll: colours() }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      w.call("polls.addAnswer", w.bob, { pollId: polled.poll.id, text: "Pink" }),
    ).rejects.toThrow(ForbiddenError);
    await vote(w, w.bob, polled.poll, [answerIds(polled.poll)[0] ?? 0]);
    // Staff who bypass the forum's rules may.
    await w.call("polls.create", w.mod, { threadId: plain.thread.id, poll: colours() });
    await w.call("polls.addAnswer", w.mod, { pollId: polled.poll.id, text: "Pink" });
  });

  test("a new account or one with few posts is held to the forum's minimums", async () => {
    const w = world();
    const polled = await withPoll(w, w.alice, colours({ allowCustom: true }));
    w.ctx.sqlite.prepare("UPDATE nodes SET min_post_count = 50 WHERE id = ?1").run(w.open.id);
    await expect(
      w.call("polls.addAnswer", w.bob, { pollId: polled.poll.id, text: "Pink" }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("a member banned from the thread", () => {
  test("cannot add an answer, and still votes", async () => {
    const w = world();
    const polled = await withPoll(w, w.alice, colours({ allowCustom: true }));
    await w.call("threadBans.create", w.mod, {
      threadId: polled.threadId,
      userId: w.bobUser.id,
      reason: "Off topic",
    });
    await expect(
      w.call("polls.addAnswer", w.bob, { pollId: polled.poll.id, text: "Pink" }),
    ).rejects.toThrow(ForbiddenError);
    const seen = (await w.call("polls.get", w.bob, { threadId: polled.threadId })).poll;
    expect(seen.permissions.canAddAnswer).toBe(false);
    await vote(w, w.bob, polled.poll, [answerIds(polled.poll)[0] ?? 0]);
  });
});

describe("closing by a moderator", () => {
  test("is not undone by the creator, whom a moderator's reopening frees again", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    await w.call("polls.close", w.mod, { pollId: poll.id, closed: true, reason: "Heated" });
    await expect(
      w.call("polls.close", w.alice, { pollId: poll.id, closed: false }),
    ).rejects.toThrow(ForbiddenError);
    // A moderator can.
    await w.call("polls.close", w.mod, { pollId: poll.id, closed: false });
    // Closed by the creator, the creator reopens.
    await w.call("polls.close", w.alice, { pollId: poll.id, closed: true });
    const reopened = await w.call("polls.close", w.alice, { pollId: poll.id, closed: false });
    expect(reopened.closed).toBe(false);
  });
});

describe("an answer that has votes", () => {
  test("is reworded by staff only; one nobody voted for by its creator too", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    await vote(w, w.bob, poll, [answerIds(poll)[0] ?? 0]);
    // Red has a vote: the creator cannot make it say something else.
    await expect(
      w.call("polls.update", w.alice, {
        pollId: poll.id,
        poll: edit(poll, (old) => (old === "Red" ? "Something else entirely" : old)),
      }),
    ).rejects.toThrow(ForbiddenError);
    // Blue has none.
    const reworded = await w.call("polls.update", w.alice, {
      pollId: poll.id,
      poll: edit(poll, (old) => (old === "Blue" ? "Navy" : old)),
    });
    expect(reworded.questions[0].answers.map((a: { text: string }) => a.text)).toEqual([
      "Red",
      "Navy",
      "Green",
    ]);
    await w.call("polls.update", w.mod, {
      pollId: poll.id,
      poll: edit(poll, (old) => (old === "Red" ? "Crimson" : old === "Blue" ? "Navy" : old)),
    });
  });
});
