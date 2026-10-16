import { describe, expect, test } from "bun:test";
import { ConflictError, ForbiddenError } from "../../errors";
import { POLL_PURGE_BATCH } from "../../limits";
import { type World, world } from "../feed/fixtures.test";
import { readSiteSettings } from "../settings";
import {
  answerIds,
  colours,
  crowd,
  type EditInput,
  type PollValue,
  withPoll,
} from "./fixtures.test";

function configure(w: World, changes: Record<string, unknown>) {
  w.ctx.sqlite
    .prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .run(JSON.stringify({ ...readSiteSettings(w.ctx), ...changes }), w.ctx.now());
}

const edit = (poll: PollValue, keep?: (text: string) => boolean): EditInput => ({
  maxChoices: poll.maxChoices,
  allowCustom: poll.allowCustom,
  allowChange: poll.allowChange,
  results: poll.results,
  closesAt: poll.closesAt,
  questions: poll.questions.map((q) => ({
    id: q.id,
    text: q.text,
    answers: q.answers
      .filter((a) => keep?.(a.text) ?? true)
      .map((a) => ({ id: a.id, text: a.text })),
  })),
});

const count = (w: World, sql: string, ...params: number[]) =>
  w.ctx.sqlite.prepare<{ n: number }, number[]>(sql).get(...params)?.n ?? 0;

describe("members whose posts are held for approval", () => {
  test("add no answer to a poll, and no poll to a thread, until their posts are free", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, colours({ allowCustom: true }));
    const plain = await w.thread(w.alice, w.open.id, "Plain");
    // The first posts of a member are held: bob has none, alice (two posts) is past one.
    configure(w, { firstPostsToModerate: 1 });
    await expect(
      w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "Pink" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "Pink" }),
    ).rejects.toThrow("held for approval");
    expect(count(w, "SELECT count(*) AS n FROM poll_answers")).toBe(3);
    // Two held posts: alice, with two, is past it; with three required she is not.
    configure(w, { firstPostsToModerate: 5 });
    await expect(
      w.call("polls.create", w.alice, { threadId: plain.thread.id, poll: colours() }),
    ).rejects.toThrow(ForbiddenError);
    expect(count(w, "SELECT count(*) AS n FROM polls")).toBe(1);
    // Once their posts are free, they may.
    configure(w, { firstPostsToModerate: 0 });
    await w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "Pink" });
    await w.call("polls.create", w.alice, { threadId: plain.thread.id, poll: colours() });
  });

  test("a member past their first posts adds an answer; voting is not held", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, colours({ allowCustom: true }));
    configure(w, { firstPostsToModerate: 1 });
    // Voting is no post: a member on probation still votes.
    await w.call("polls.vote", w.bob, {
      pollId: poll.id,
      questionId: poll.questions[0]?.id,
      answerIds: [answerIds(poll)[0]],
    });
    // Carol writes her first post (held or not, it counts), then she may add an answer.
    await w.reply(w.carol, poll.threadId, "A reply");
    await w.call("polls.addAnswer", w.carol, { pollId: poll.id, text: "Pink" });
  });

  test("a rule added between the first look and the write is judged in the write", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, colours({ allowCustom: true }));
    await w.call("wordFilters.upsert", w.admin, { term: "heck", action: "moderate" });
    await expect(
      w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "what heck" }),
    ).rejects.toThrow();
    expect(count(w, "SELECT count(*) AS n FROM poll_answers")).toBe(3);
  });
});

describe("the stale-editor refusal is told apart from the others", () => {
  test("only the stale one names the version", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, colours({ allowCustom: true }));
    const loaded = (await w.call("polls.definition", w.alice, { pollId: poll.id })).updatedAt;
    await w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "Pink" });
    const stale = await w
      .call("polls.update", w.alice, { pollId: poll.id, poll: edit(poll), loadedAt: loaded })
      .catch((error: unknown) => error);
    expect(stale).toBeInstanceOf(ConflictError);
    expect((stale as ConflictError).issues?.[0]?.path).toEqual(["loadedAt"]);
    // An answer with more votes than one batch cannot be removed in one step: another conflict,
    // and not the stale one.
    const big = await withPoll(w, w.alice, colours(), "Big");
    crowd(w, big.poll, POLL_PURGE_BATCH * 3 + 3);
    const refused = await w
      .call("polls.update", w.mod, {
        pollId: big.poll.id,
        poll: edit(big.poll, (text) => text !== "Red"),
      })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ConflictError);
    expect((refused as ConflictError).issues).toBeUndefined();
  }, 60_000);

  test("a version that is a plain second-resolution time is read as a time", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    const definition = await w.call("polls.definition", w.alice, { pollId: poll.id });
    const sameInstant = new Date(Date.parse(definition.updatedAt)).toISOString();
    await w.call("polls.update", w.alice, {
      pollId: poll.id,
      poll: edit(poll),
      loadedAt: sameInstant,
    });
  });
});

describe("what an edit that names no version may not take away", () => {
  test("an answer a voter added stays unless the edit says it saw it", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, colours({ allowCustom: true }));
    await w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "Pink" });
    // An old read: the list has the three answers only. No version, so the new one stays.
    const kept = await w.call("polls.update", w.alice, { pollId: poll.id, poll: edit(poll) });
    expect(kept.questions[0].answers.map((a: { text: string }) => a.text)).toEqual([
      "Red",
      "Blue",
      "Green",
      "Pink",
    ]);
    // With the version of a fresh read, leaving it out removes it (nobody voted for it).
    const fresh = await w.call("polls.definition", w.alice, { pollId: poll.id });
    const withoutPink = edit(poll);
    await w.call("polls.update", w.alice, {
      pollId: poll.id,
      poll: withoutPink,
      loadedAt: fresh.updatedAt,
    });
    expect(count(w, "SELECT count(*) AS n FROM poll_answers")).toBe(3);
  });
});

describe("small things", () => {
  test("closing a closed poll, or reopening an open one, changes nothing", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    const stamp = async () =>
      (await w.call("polls.definition", w.alice, { pollId: poll.id })).updatedAt;
    const first = await stamp();
    await w.call("polls.close", w.alice, { pollId: poll.id, closed: false });
    expect(await stamp()).toBe(first);
    await w.call("polls.close", w.alice, { pollId: poll.id, closed: true });
    const closed = await stamp();
    expect(closed).not.toBe(first);
    await w.call("polls.close", w.alice, { pollId: poll.id, closed: true });
    expect(await stamp()).toBe(closed);
  });

  test("a poll being deleted leaves the search index with the first batch", async () => {
    const w = world();
    const { poll } = await withPoll(
      w,
      w.alice,
      colours({ questions: [{ text: "Which quokka?", answers: [{ text: "A" }, { text: "B" }] }] }),
    );
    crowd(w, poll, POLL_PURGE_BATCH + 1);
    const search = async () =>
      (await w.call("search.query", w.bob, { q: "quokka" })).items.length as number;
    expect(await search()).toBe(1);
    expect((await w.call("polls.delete", w.mod, { pollId: poll.id })).completed).toBe(false);
    expect(await search()).toBe(0);
  }, 60_000);

  test("an explanation whose words fit but whose tags push it past the raw cap is accepted", async () => {
    const w = world();
    const explanation = `[b]${"x".repeat(450)}[/b]`;
    const made = await withPoll(
      w,
      w.alice,
      {
        kind: "quiz",
        questions: [
          { text: "Q", explanation, answers: [{ text: "A", correct: true }, { text: "B" }] },
        ],
      },
      "Quiz",
    );
    expect(made.poll.questions).toHaveLength(1);
    const definition = await w.call("polls.definition", w.alice, { pollId: made.poll.id });
    expect(definition.questions[0].explanation).toBe("x".repeat(450));
  });
});
