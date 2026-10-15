import { describe, expect, test } from "bun:test";
import { actorUserId, GUEST } from "../../actor";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { PERMISSIONS } from "../../permissions";
import { type World, world } from "../feed/fixtures.test";
import { customMember, setEntry } from "../permissions/group-fixture";
import {
  type AnswerValue,
  answerIds,
  colours,
  counts,
  type EditInput,
  type PollValue,
  pollVoteCount,
  withPoll,
} from "./fixtures.test";

const MEMBERS = 2;
const GUESTS = 1;

const vote = (w: World, actor: World["alice"], poll: PollValue, answers: number[], q = 0) =>
  w.call("polls.vote", actor, {
    pollId: poll.id,
    questionId: poll.questions[q]!.id,
    answerIds: answers,
  });
const votes = (poll: PollValue) => poll.questions[0]!.answers.map((a) => a.votes);
describe("registry", () => {
  test("members make, vote and close their own; staff manage", () => {
    const posters = { registered: "allow", moderator: "allow", admin: "allow" } as const;
    const staff = { moderator: "allow", admin: "allow" } as const;
    expect(PERMISSIONS["poll.create"].defaults).toEqual(posters);
    expect(PERMISSIONS["poll.vote"].defaults).toEqual(posters);
    expect(PERMISSIONS["poll.addAnswer"].defaults).toEqual(posters);
    expect(PERMISSIONS["poll.closeOwn"].defaults).toEqual(posters);
    expect(PERMISSIONS["poll.viewVoters"].defaults).toEqual(posters);
    expect(PERMISSIONS["poll.closeAny"].defaults).toEqual(staff);
    expect(PERMISSIONS["poll.manage"].defaults).toEqual(staff);
  });
});

describe("making a poll", () => {
  test("written with the thread, it is the thread's poll", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(w, w.alice);
    expect(poll).toMatchObject({
      threadId,
      kind: "poll",
      anonymous: false,
      maxChoices: 1,
      allowCustom: false,
      allowChange: true,
      results: "always",
      closed: false,
      resultsShown: true,
      voterCount: 0,
    });
    expect(poll.questions).toHaveLength(1);
    expect(poll.questions[0]!.answers.map((a: { text: string }) => a.text)).toEqual([
      "Red",
      "Blue",
      "Green",
    ]);
    expect(poll.permissions).toMatchObject({ canEdit: true, canDelete: true, canClose: true });
    // Another thread has none.
    const plain = await w.thread(w.alice, w.open.id, "Plain");
    expect(await w.call("polls.get", w.bob, { threadId: plain.thread.id })).toEqual({
      poll: null,
      canCreate: false,
    });
    expect((await w.call("polls.get", w.alice, { threadId: plain.thread.id })).canCreate).toBe(
      true,
    );
  });

  test("added later by the author or staff, never by another member", async () => {
    const w = world();
    const plain = await w.thread(w.alice, w.open.id, "Plain");
    const threadId = plain.thread.id;
    await expect(w.call("polls.create", w.bob, { threadId, poll: colours() })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(w.call("polls.create", GUEST, { threadId, poll: colours() })).rejects.toThrow(
      UnauthenticatedError,
    );
    const made = await w.call("polls.create", w.alice, { threadId, poll: colours() });
    expect(made.threadId).toBe(threadId);
    // One poll a thread.
    await expect(w.call("polls.create", w.alice, { threadId, poll: colours() })).rejects.toThrow(
      ConflictError,
    );
    await expect(w.call("polls.create", w.mod, { threadId, poll: colours() })).rejects.toThrow(
      ConflictError,
    );
    const other = await w.thread(w.bob, w.open.id, "Bob's");
    const byStaff = await w.call("polls.create", w.mod, {
      threadId: other.thread.id,
      poll: colours(),
    });
    expect(byStaff.permissions.canEdit).toBe(true);
    // The staff addition is logged.
    const log = w.ctx.sqlite
      .prepare<{ action: string; target_id: number }, []>(
        "SELECT action, target_id FROM moderator_log WHERE action = 'poll.create'",
      )
      .all();
    expect(log).toEqual([{ action: "poll.create", target_id: other.thread.id }]);
  });

  test("the author of a locked thread cannot add one; staff can", async () => {
    const w = world();
    const plain = await w.thread(w.alice, w.open.id, "Locked");
    await w.call("threads.setLocked", w.mod, { threadId: plain.thread.id, isLocked: true });
    await expect(
      w.call("polls.create", w.alice, { threadId: plain.thread.id, poll: colours() }),
    ).rejects.toThrow(ForbiddenError);
    await w.call("polls.create", w.mod, { threadId: plain.thread.id, poll: colours() });
  });

  test("without poll.create nobody starts one, with a thread or after it", async () => {
    const w = world();
    const member = customMember(w.ctx, ["site.view", "node.view", "forum.createThread"]);
    await expect(
      w.call("threads.create", member.actor, {
        nodeId: w.open.id,
        title: "T",
        body: "B",
        poll: colours(),
      }),
    ).rejects.toThrow(ForbiddenError);
    const plain = await w.call("threads.create", member.actor, {
      nodeId: w.open.id,
      title: "T",
      body: "B",
    });
    await expect(
      w.call("polls.create", member.actor, { threadId: plain.thread.id, poll: colours() }),
    ).rejects.toThrow(ForbiddenError);
    expect((await w.call("polls.get", member.actor, { threadId: plain.thread.id })).canCreate).toBe(
      false,
    );
  });

  test("a posting restriction takes poll.create away", async () => {
    const w = world();
    const plain = await w.thread(w.alice, w.open.id, "Plain");
    await w.call("restrictions.create", w.admin, {
      userId: w.aliceUser.id,
      kind: "posting",
      reason: "Mute",
      expiresAt: null,
      notify: false,
    });
    await expect(
      w.call("polls.create", w.alice, { threadId: plain.thread.id, poll: colours() }),
    ).rejects.toThrow(ForbiddenError);
  });

  test("what the definition must hold", async () => {
    const w = world();
    const make = (poll: object) =>
      w.call("threads.create", w.alice, { nodeId: w.open.id, title: "T", body: "B", poll });
    const q = (answers: object[], extra: object = {}) => ({ text: "Question", answers, ...extra });
    const two = [{ text: "A" }, { text: "B" }];
    // A poll is one question.
    await expect(make({ questions: [q(two), q(two)] })).rejects.toThrow(ValidationError);
    // At least two answers, at most twenty.
    await expect(make({ questions: [q([{ text: "A" }])] })).rejects.toThrow(ValidationError);
    await expect(
      make({ questions: [q(Array.from({ length: 21 }, (_, i) => ({ text: `A${i}` })))] }),
    ).rejects.toThrow(ValidationError);
    // The same answer twice, whatever the case.
    await expect(make({ questions: [q([{ text: "A" }, { text: "a" }])] })).rejects.toThrow(
      ValidationError,
    );
    // A vote cannot pick more than there are.
    await expect(make({ maxChoices: 3, questions: [q(two)] })).rejects.toThrow(ValidationError);
    // Only a quiz has right answers and explanations.
    await expect(
      make({ questions: [q([{ text: "A", correct: true }, { text: "B" }])] }),
    ).rejects.toThrow(ValidationError);
    await expect(make({ questions: [q(two, { explanation: "Because" })] })).rejects.toThrow(
      ValidationError,
    );
    // A close date in the past.
    await expect(
      make({ closesAt: new Date(w.ctx.now() - 1000).toISOString(), questions: [q(two)] }),
    ).rejects.toThrow(ValidationError);
    // Nothing was made by the refused ones.
    expect(w.ctx.sqlite.prepare("SELECT count(*) AS n FROM polls").get()).toEqual({ n: 0 });
    expect(w.ctx.sqlite.prepare("SELECT count(*) AS n FROM threads").get()).toEqual({ n: 0 });
  });

  test("texts are read for their words: BB code leaves its text, one line", async () => {
    const w = world();
    const { poll } = await withPoll(
      w,
      w.alice,
      colours({
        questions: [
          {
            text: "[b]Which[/b]\n[url=https://example.test]one[/url] [img]https://example.test/a.png[/img]?",
            answers: [{ text: "[color=red]Red[/color]" }, { text: "  Blue\n  sky  " }],
          },
        ],
      }),
    );
    expect(poll.questions[0]!.text).toBe("Which one ?");
    expect(poll.questions[0]!.answers.map((a: { text: string }) => a.text)).toEqual([
      "Red",
      "Blue sky",
    ]);
    // Nothing but BB code is nothing.
    await expect(
      w.call("threads.create", w.alice, {
        nodeId: w.open.id,
        title: "T",
        body: "B",
        poll: colours({
          questions: [
            {
              text: "[img]https://example.test/a.png[/img]",
              answers: [{ text: "A" }, { text: "B" }],
            },
          ],
        }),
      }),
    ).rejects.toThrow(ValidationError);
  });

  test("the word filter rewrites, and a text it holds for approval is refused", async () => {
    const w = world();
    await w.call("wordFilters.upsert", w.admin, {
      term: "darn",
      action: "replace",
      replacement: "***",
    });
    await w.call("wordFilters.upsert", w.admin, { term: "heck", action: "moderate" });
    const { poll } = await withPoll(
      w,
      w.alice,
      colours({
        questions: [{ text: "Is it darn good?", answers: [{ text: "darn yes" }, { text: "No" }] }],
      }),
    );
    expect(poll.questions[0]!.text).toBe("Is it *** good?");
    expect(poll.questions[0]!.answers[0]!.text).toBe("*** yes");
    // With a new thread a held text holds the thread; added later it is refused.
    const held = await w.call("threads.create", w.alice, {
      nodeId: w.open.id,
      title: "Held",
      body: "Body",
      poll: colours({
        questions: [{ text: "What the heck?", answers: [{ text: "A" }, { text: "B" }] }],
      }),
    });
    expect(held.thread.state).toBe("moderated");
    const plain = await w.thread(w.alice, w.open.id, "Plain");
    await expect(
      w.call("polls.create", w.alice, {
        threadId: plain.thread.id,
        poll: colours({
          questions: [{ text: "The heck?", answers: [{ text: "A" }, { text: "B" }] }],
        }),
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("voting", () => {
  test("a vote counts once, can be changed and moves the counts", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    const [red, blue] = answerIds(poll);
    const first = await vote(w, w.bob, poll, [red!]);
    expect(votes(first)).toEqual([1, 0, 0]);
    expect(first.questions[0].answers[0].chosen).toBe(true);
    expect(first.mine).toMatchObject({ voted: true, answered: 1 });
    expect(first.voterCount).toBe(1);
    // Changing moves the vote; the triggers keep the counters.
    const changed = await vote(w, w.bob, poll, [blue!]);
    expect(votes(changed)).toEqual([0, 1, 0]);
    expect(counts(w, poll.id)).toEqual([0, 1, 0]);
    expect(changed.voterCount).toBe(1);
    await vote(w, w.carol, poll, [blue!]);
    expect(counts(w, poll.id)).toEqual([0, 2, 0]);
    expect(pollVoteCount(w, w.bobUser.id)).toBe(1);
    // The same vote again changes nothing.
    await vote(w, w.carol, poll, [blue!]);
    expect(counts(w, poll.id)).toEqual([0, 2, 0]);
    expect(pollVoteCount(w, w.carolUser.id)).toBe(1);
  });

  test("a poll that does not allow changes keeps the first vote", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, colours({ allowChange: false }));
    const [red, blue] = answerIds(poll);
    await vote(w, w.bob, poll, [red!]);
    await expect(vote(w, w.bob, poll, [blue!])).rejects.toThrow(ConflictError);
    expect(counts(w, poll.id)).toEqual([1, 0, 0]);
    const seen = (await w.call("polls.get", w.bob, { threadId: poll.threadId })).poll;
    expect(seen.permissions.canVote).toBe(false);
    expect(
      (await w.call("polls.get", w.carol, { threadId: poll.threadId })).poll.permissions.canVote,
    ).toBe(true);
  });

  test("multiple choice: up to maxChoices, replaced as a whole", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, colours({ maxChoices: 2 }));
    const [red, blue, green] = answerIds(poll);
    await expect(vote(w, w.bob, poll, [red!, blue!, green!])).rejects.toThrow(ValidationError);
    const two = await vote(w, w.bob, poll, [red!, blue!]);
    expect(votes(two)).toEqual([1, 1, 0]);
    expect(two.voterCount).toBe(1);
    const swapped = await vote(w, w.bob, poll, [green!]);
    expect(votes(swapped)).toEqual([0, 0, 1]);
    // An answer twice, an answer of nowhere, a question of nowhere.
    await expect(vote(w, w.bob, poll, [red!, red!])).rejects.toThrow(ValidationError);
    await expect(vote(w, w.bob, poll, [999_999])).rejects.toThrow(ValidationError);
    await expect(
      w.call("polls.vote", w.bob, { pollId: poll.id, questionId: 999_999, answerIds: [red!] }),
    ).rejects.toThrow(ValidationError);
    expect(counts(w, poll.id)).toEqual([0, 0, 1]);
  });

  test("an answer of another poll is not an answer here", async () => {
    const w = world();
    const one = await withPoll(w, w.alice, colours(), "One");
    const two = await withPoll(w, w.alice, colours(), "Two");
    await expect(vote(w, w.bob, one.poll, answerIds(two.poll).slice(0, 1))).rejects.toThrow(
      ValidationError,
    );
    expect(counts(w, one.poll.id)).toEqual([0, 0, 0]);
    expect(counts(w, two.poll.id)).toEqual([0, 0, 0]);
  });

  test("who may vote", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(w, w.alice);
    const [red] = answerIds(poll);
    await expect(vote(w, GUEST, poll, [red!])).rejects.toThrow(UnauthenticatedError);
    const noVote = customMember(w.ctx, ["site.view", "node.view"]);
    await expect(vote(w, noVote.actor, poll, [red!])).rejects.toThrow(ForbiddenError);
    const allowed = customMember(w.ctx, ["site.view", "node.view", "poll.vote"]);
    await vote(w, allowed.actor, poll, [red!]);
    // The author, a moderator and an administrator vote like anyone.
    for (const actor of [w.alice, w.mod, w.admin]) await vote(w, actor, poll, [red!]);
    expect(counts(w, poll.id)).toEqual([4, 0, 0]);
    // What the page shows.
    const can = async (actor: World["alice"]) =>
      (await w.call("polls.get", actor, { threadId })).poll.permissions.canVote;
    expect([await can(GUEST), await can(noVote.actor), await can(w.bob)]).toEqual([
      false,
      false,
      true,
    ]);
  });

  test("a thread that is hidden, held or gone takes no vote", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(w, w.alice);
    const [red] = answerIds(poll);
    await w.call("threads.delete", w.mod, { threadId, reason: "x", notify: false });
    await expect(vote(w, w.bob, poll, [red!])).rejects.toThrow(NotFoundError);
    // Its author still opens it, and staff: neither votes while it is deleted.
    await expect(vote(w, w.mod, poll, [red!])).rejects.toThrow(ForbiddenError);
    await w.call("threads.restore", w.mod, { threadId, reason: "x", notify: false });
    await vote(w, w.bob, poll, [red!]);
    expect(counts(w, poll.id)).toEqual([1, 0, 0]);
    // A forum nobody but staff can open.
    const hidden = await w.call("threads.create", w.admin, {
      nodeId: w.secret.id,
      title: "Staff",
      body: "B",
      poll: colours(),
    });
    const secret = (await w.call("polls.get", w.admin, { threadId: hidden.thread.id })).poll;
    await expect(vote(w, w.bob, secret, [answerIds(secret)[0]!])).rejects.toThrow(NotFoundError);
    await expect(w.call("polls.get", w.bob, { threadId: hidden.thread.id })).rejects.toThrow(
      NotFoundError,
    );
  });

  test("a locked thread still takes votes", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(w, w.alice);
    await w.call("threads.setLocked", w.mod, { threadId, isLocked: true });
    await vote(w, w.bob, poll, [answerIds(poll)[0]!]);
    expect(counts(w, poll.id)).toEqual([1, 0, 0]);
  });

  test("the thread's read gates: a titles-only reader cannot see, vote or list voters", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(w, w.alice);
    const [red] = answerIds(poll);
    await vote(w, w.bob, poll, [red!]);
    setEntry(w.ctx, MEMBERS, "forum.viewContent", -1, w.open.id);
    const reader = w.carol;
    expect(await w.call("polls.get", reader, { threadId })).toEqual({
      poll: null,
      canCreate: false,
    });
    await expect(vote(w, reader, poll, [red!])).rejects.toThrow(ForbiddenError);
    await expect(
      w.call("polls.voters", reader, { pollId: poll.id, answerId: red }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      w.call("polls.addAnswer", reader, { pollId: poll.id, text: "Pink" }),
    ).rejects.toThrow(ForbiddenError);
    // The author reads their own work; staff read through their own group.
    expect((await w.call("polls.get", w.alice, { threadId })).poll).not.toBeNull();
    expect(counts(w, poll.id)).toEqual([1, 0, 0]);
  });

  test("other members' threads closed (viewOthers): not found", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(w, w.alice);
    setEntry(w.ctx, MEMBERS, "forum.viewOthers", -1, w.open.id);
    await expect(w.call("polls.get", w.bob, { threadId })).rejects.toThrow(NotFoundError);
    await expect(vote(w, w.bob, poll, [answerIds(poll)[0]!])).rejects.toThrow(NotFoundError);
    expect((await w.call("polls.get", w.alice, { threadId })).poll).not.toBeNull();
  });

  test("a site that is closed to the visitor shows no poll", async () => {
    const w = world();
    const { threadId } = await withPoll(w, w.alice);
    setEntry(w.ctx, GUESTS, "site.view", -1);
    await expect(w.call("polls.get", GUEST, { threadId })).rejects.toThrow();
  });
});

describe("results", () => {
  test("always, after voting, after the poll closes", async () => {
    const w = world();
    const always = await withPoll(w, w.alice, colours(), "Always");
    const afterVote = await withPoll(w, w.alice, colours({ results: "after_vote" }), "After vote");
    const afterClose = await withPoll(
      w,
      w.alice,
      colours({ results: "after_close" }),
      "After close",
    );
    for (const { poll } of [always, afterVote, afterClose])
      await vote(w, w.bob, poll, [answerIds(poll)[0]!]);
    const read = async (made: { threadId: number }, actor: World["alice"]) =>
      (await w.call("polls.get", actor, { threadId: made.threadId })).poll;
    // Someone who has not voted, a guest, someone who has.
    expect((await read(always, w.carol)).resultsShown).toBe(true);
    expect(votes(await read(always, GUEST))).toEqual([1, 0, 0]);
    const hidden = await read(afterVote, w.carol);
    expect(hidden).toMatchObject({ resultsShown: false, voterCount: null });
    expect(votes(hidden)).toEqual([null, null, null]);
    expect(votes(await read(afterVote, GUEST))).toEqual([null, null, null]);
    expect(votes(await read(afterVote, w.bob))).toEqual([1, 0, 0]);
    expect(votes(await read(afterClose, w.bob))).toEqual([null, null, null]);
    // The creator and staff who manage polls see them whatever the rule says.
    for (const actor of [w.alice, w.mod, w.admin])
      expect(votes(await read(afterClose, actor))).toEqual([1, 0, 0]);
    // Voting reveals the counts in the answer.
    const after = await vote(w, w.carol, afterVote.poll, [answerIds(afterVote.poll)[1]!]);
    expect(votes(after)).toEqual([1, 1, 0]);
    // Closing shows them to everyone.
    await w.call("polls.close", w.alice, { pollId: afterClose.poll.id, closed: true });
    expect(votes(await read(afterClose, w.carol))).toEqual([1, 0, 0]);
    expect(votes(await read(afterVote, w.carol))).toEqual([1, 1, 0]);
    await w.call("polls.close", w.alice, { pollId: afterVote.poll.id, closed: true });
    expect(votes(await read(afterVote, GUEST))).toEqual([1, 1, 0]);
  });

  test("voters list: public polls, with the permission and the results shown", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, colours({ results: "after_vote" }));
    const [red, blue] = answerIds(poll);
    await vote(w, w.bob, poll, [red!]);
    await vote(w, w.carol, poll, [red!]);
    const list = (actor: World["alice"], answerId = red!) =>
      w.call("polls.voters", actor, { pollId: poll.id, answerId });
    expect(
      (await list(w.bob)).items.map((item: { user: { username: string } }) => item.user.username),
    ).toEqual(["bob", "carol"]);
    expect((await list(w.bob, blue!)).items).toEqual([]);
    // Not before the viewer's own vote shows them the results.
    await expect(list(w.alice)).resolves.toBeDefined();
    const outsider = customMember(w.ctx, [
      "site.view",
      "node.view",
      "poll.vote",
      "poll.viewVoters",
    ]);
    await expect(list(outsider.actor)).rejects.toThrow(ForbiddenError);
    await vote(w, outsider.actor, poll, [blue!]);
    expect((await list(outsider.actor)).items).toHaveLength(2);
    // Without poll.viewVoters, and as a guest.
    const noView = customMember(w.ctx, ["site.view", "node.view", "poll.vote"]);
    await vote(w, noView.actor, poll, [blue!]);
    await expect(list(noView.actor)).rejects.toThrow(ForbiddenError);
    await expect(list(GUEST)).rejects.toThrow(UnauthenticatedError);
    // The flag follows.
    const seen = (await w.call("polls.get", w.bob, { threadId: poll.threadId })).poll;
    expect(seen.permissions.canViewVoters).toBe(true);
    expect(
      (await w.call("polls.get", noView.actor, { threadId: poll.threadId })).poll.permissions
        .canViewVoters,
    ).toBe(false);
    // An answer that is not the poll's.
    await expect(list(w.bob, 999_999)).rejects.toThrow(NotFoundError);
  });

  test("the voters list pages by member", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    const red = answerIds(poll)[0]!;
    await vote(w, w.alice, poll, [red]);
    await vote(w, w.bob, poll, [red]);
    await vote(w, w.carol, poll, [red]);
    const first = await w.call("polls.voters", w.bob, { pollId: poll.id, answerId: red, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await w.call("polls.voters", w.bob, {
      pollId: poll.id,
      answerId: red,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(
      [...first.items, ...second.items]
        .map((item: { user: { id: number } }) => item.user.id)
        .sort(),
    ).toEqual([w.aliceUser.id, w.bobUser.id, w.carolUser.id].sort());
  });
});

describe("closing", () => {
  test("by hand and by date, and reopened", async () => {
    const w = world();
    const closesAt = new Date(w.ctx.now() + 3_600_000).toISOString();
    const { poll } = await withPoll(w, w.alice, colours({ closesAt }));
    const [red] = answerIds(poll);
    await vote(w, w.bob, poll, [red!]);
    // The date passes: closed without anyone doing anything.
    w.ctx.clock.advance(2 * 3_600_000);
    const late = (await w.call("polls.get", w.carol, { threadId: poll.threadId })).poll;
    expect(late).toMatchObject({ closed: true });
    expect(late.permissions.canVote).toBe(false);
    await expect(vote(w, w.carol, poll, [red!])).rejects.toThrow(ConflictError);
    // Reopening clears the passed date.
    const reopened = await w.call("polls.close", w.alice, { pollId: poll.id, closed: false });
    expect(reopened).toMatchObject({ closed: false, closesAt: null });
    await vote(w, w.carol, poll, [red!]);
    // By hand, and again (no harm).
    const closed = await w.call("polls.close", w.alice, { pollId: poll.id, closed: true });
    expect(closed.closed).toBe(true);
    await w.call("polls.close", w.alice, { pollId: poll.id, closed: true });
    await expect(vote(w, w.bob, poll, [red!])).rejects.toThrow(ConflictError);
    expect(counts(w, poll.id)).toEqual([2, 0, 0]);
  });

  test("the creator with poll.closeOwn, anyone with poll.closeAny, nobody else", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    await expect(w.call("polls.close", w.bob, { pollId: poll.id, closed: true })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(w.call("polls.close", GUEST, { pollId: poll.id, closed: true })).rejects.toThrow();
    const ownOnly = customMember(w.ctx, ["site.view", "node.view", "poll.closeOwn"]);
    await expect(
      w.call("polls.close", ownOnly.actor, { pollId: poll.id, closed: true }),
    ).rejects.toThrow(ForbiddenError);
    // A creator without poll.closeOwn cannot close their own.
    const noClose = customMember(w.ctx, [
      "site.view",
      "node.view",
      "poll.create",
      "forum.createThread",
    ]);
    const made = await withPoll(w, noClose.actor);
    await expect(
      w.call("polls.close", noClose.actor, { pollId: made.poll.id, closed: true }),
    ).rejects.toThrow(ForbiddenError);
    expect(made.poll.permissions.canClose).toBe(false);
    // A moderator's close is logged.
    await w.call("polls.close", w.mod, { pollId: poll.id, closed: true, reason: "Enough" });
    await w.call("polls.close", w.mod, { pollId: poll.id, closed: false });
    await w.call("polls.close", w.alice, { pollId: poll.id, closed: true });
    expect(
      w.ctx.sqlite
        .prepare<{ action: string; reason: string }, []>(
          "SELECT action, reason FROM moderator_log WHERE action LIKE 'poll.%' ORDER BY id",
        )
        .all(),
    ).toEqual([
      { action: "poll.close", reason: "Enough" },
      { action: "poll.reopen", reason: "" },
    ]);
  });
});

describe("custom answers", () => {
  const custom = () => colours({ allowCustom: true });

  test("a voter adds one, once, and can vote for it", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, custom());
    expect(poll.permissions.canAddAnswer).toBe(true);
    const added = await w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "[b]Pink[/b]" });
    const pink = added.questions[0].answers.at(-1);
    expect(pink).toMatchObject({ text: "Pink", custom: true });
    expect(added.permissions.canAddAnswer).toBe(false);
    await expect(
      w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "Teal" }),
    ).rejects.toThrow(ConflictError);
    // A text the poll already offers is picked, not added.
    await expect(
      w.call("polls.addAnswer", w.carol, { pollId: poll.id, text: "red" }),
    ).rejects.toThrow(ConflictError);
    const voted = await vote(w, w.carol, added, [pink.id]);
    expect(votes(voted)).toEqual([0, 0, 0, 1]);
    // The creator sees it in the definition, flagged.
    const definition = await w.call("polls.definition", w.alice, { pollId: poll.id });
    expect(definition.questions[0].answers.at(-1)).toMatchObject({ custom: true, votes: 1 });
  });

  test("only where the poll allows it, for a quiz never, and under the posting rules", async () => {
    const w = world();
    const plain = await withPoll(w, w.alice, colours(), "Plain");
    await expect(
      w.call("polls.addAnswer", w.bob, { pollId: plain.poll.id, text: "Pink" }),
    ).rejects.toThrow(ConflictError);
    expect(plain.poll.permissions.canAddAnswer).toBe(false);
    const { poll } = await withPoll(w, w.alice, custom(), "Custom");
    await expect(
      w.call("polls.addAnswer", GUEST, { pollId: poll.id, text: "Pink" }),
    ).rejects.toThrow(UnauthenticatedError);
    const noAdd = customMember(w.ctx, ["site.view", "node.view", "poll.vote"]);
    await expect(
      w.call("polls.addAnswer", noAdd.actor, { pollId: poll.id, text: "Pink" }),
    ).rejects.toThrow(ForbiddenError);
    await w.call("restrictions.create", w.admin, {
      userId: w.carolUser.id,
      kind: "posting",
      reason: "Mute",
      expiresAt: null,
      notify: false,
    });
    await expect(
      w.call("polls.addAnswer", w.carol, { pollId: poll.id, text: "Pink" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      w.call("threads.create", w.alice, {
        nodeId: w.open.id,
        title: "Quiz",
        body: "B",
        poll: {
          kind: "quiz",
          allowCustom: true,
          questions: [{ text: "Q", answers: [{ text: "A", correct: true }, { text: "B" }] }],
        },
      }),
    ).rejects.toThrow(ValidationError);
  });

  test("the text rules: length, words only, the word filter, a closed poll", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, custom());
    await expect(
      w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "x".repeat(101) }),
    ).rejects.toThrow(ValidationError);
    await expect(
      w.call("polls.addAnswer", w.bob, {
        pollId: poll.id,
        text: "[img]https://example.test/a.png[/img]",
      }),
    ).rejects.toThrow(ValidationError);
    await w.call("wordFilters.upsert", w.admin, { term: "heck", action: "moderate" });
    await expect(
      w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "What heck" }),
    ).rejects.toThrow(ValidationError);
    await w.call("wordFilters.upsert", w.admin, {
      term: "darn",
      action: "replace",
      replacement: "***",
    });
    const added = await w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "darn it" });
    expect(added.questions[0].answers.at(-1).text).toBe("*** it");
    await w.call("polls.close", w.alice, { pollId: poll.id, closed: true });
    await expect(
      w.call("polls.addAnswer", w.carol, { pollId: poll.id, text: "Late" }),
    ).rejects.toThrow(ConflictError);
  });

  test("a poll holds at most twenty answers", async () => {
    const w = world();
    const answers = Array.from({ length: 20 }, (_, i) => ({ text: `A${i}` }));
    const { poll } = await withPoll(
      w,
      w.alice,
      colours({ allowCustom: true, questions: [{ text: "Many", answers }] }),
    );
    await expect(
      w.call("polls.addAnswer", w.bob, { pollId: poll.id, text: "One more" }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("editing and deleting", () => {
  const edit = (poll: PollValue, over: object = {}, q: object = {}): EditInput => ({
    maxChoices: poll.maxChoices,
    allowCustom: poll.allowCustom,
    allowChange: poll.allowChange,
    results: poll.results,
    closesAt: poll.closesAt,
    questions: [
      {
        id: poll.questions[0]!.id,
        text: poll.questions[0]!.text,
        ...q,
        answers: poll.questions[0]!.answers.map((a) => ({ id: a.id, text: a.text })),
      },
    ],
    ...over,
  });

  test("the creator changes texts and settings and adds answers; votes stay", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice);
    const [red, blue] = answerIds(poll);
    await vote(w, w.bob, poll, [red!]);
    const input = edit(
      poll,
      { results: "after_vote", allowCustom: true },
      { text: "Best colour of all?" },
    );
    input.questions[0]!.answers[0]!.text = "Crimson";
    input.questions[0]!.answers.push({ text: "Yellow" } as never);
    const updated = await w.call("polls.update", w.alice, { pollId: poll.id, poll: input });
    expect(updated.questions[0].text).toBe("Best colour of all?");
    expect(updated.questions[0].answers.map((a: AnswerValue) => a.text)).toEqual([
      "Crimson",
      "Blue",
      "Green",
      "Yellow",
    ]);
    expect(updated).toMatchObject({ results: "after_vote", allowCustom: true });
    expect(updated.questions[0].answers[0]).toMatchObject({ id: red, votes: 1 });
    expect(blue).toBeDefined();
    // Another member cannot, a guest cannot.
    await expect(w.call("polls.update", w.bob, { pollId: poll.id, poll: input })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(w.call("polls.update", GUEST, { pollId: poll.id, poll: input })).rejects.toThrow();
  });

  test("removing answers: the creator only where nobody voted, staff always (the votes go)", async () => {
    const w = world();
    const four = colours({
      questions: [
        { text: "Colour?", answers: ["Red", "Blue", "Green", "Pink"].map((text) => ({ text })) },
      ],
    });
    const { poll } = await withPoll(w, w.alice, four);
    const [red, blue, green, pink] = answerIds(poll);
    await vote(w, w.bob, poll, [red!]);
    await vote(w, w.carol, poll, [blue!]);
    const without = (from: PollValue, ids: number[]) => {
      const input = edit(from);
      input.questions[0]!.answers = input.questions[0]!.answers.filter((a) => !ids.includes(a.id!));
      return input;
    };
    // Green has no votes: the creator may drop it.
    const trimmed = await w.call("polls.update", w.alice, {
      pollId: poll.id,
      poll: without(poll, [green!]),
    });
    expect(trimmed.questions[0].answers).toHaveLength(3);
    // Red has: only staff may.
    await expect(
      w.call("polls.update", w.alice, { pollId: poll.id, poll: without(trimmed, [red!]) }),
    ).rejects.toThrow(ForbiddenError);
    expect(counts(w, poll.id)).toEqual([1, 1, 0]);
    // A poll keeps two answers at least.
    await expect(
      w.call("polls.update", w.mod, { pollId: poll.id, poll: without(trimmed, [red!, blue!]) }),
    ).rejects.toThrow(ValidationError);
    const staff = without(trimmed, [red!, pink!]);
    staff.questions[0]!.answers.push({ text: "Yellow" } as never);
    const after = await w.call("polls.update", w.mod, {
      pollId: poll.id,
      poll: staff,
      reason: "Spam",
    });
    expect(after.questions[0].answers.map((a: AnswerValue) => a.text)).toEqual(["Blue", "Yellow"]);
    // Bob lost his only vote: he is no voter any more and may vote again.
    expect(after.voterCount).toBe(1);
    expect(pollVoteCount(w, w.bobUser.id)).toBe(0);
    expect(pollVoteCount(w, w.carolUser.id)).toBe(1);
    await vote(w, w.bob, after, [after.questions[0].answers[1].id]);
    expect(counts(w, poll.id)).toEqual([1, 1]);
    expect(
      w.ctx.sqlite
        .prepare<{ action: string; reason: string }, []>(
          "SELECT action, reason FROM moderator_log WHERE action = 'poll.update'",
        )
        .all(),
    ).toEqual([{ action: "poll.update", reason: "Spam" }]);
  });

  test("an id that is not the poll's is refused; the kind and anonymity never change", async () => {
    const w = world();
    const { poll } = await withPoll(w, w.alice, colours({ anonymous: true }));
    const other = await withPoll(w, w.alice, colours(), "Other");
    const input = edit(poll);
    input.questions[0]!.answers[0]!.id = answerIds(other.poll)[0]!;
    await expect(w.call("polls.update", w.alice, { pollId: poll.id, poll: input })).rejects.toThrow(
      ValidationError,
    );
    const q = edit(poll, {}, {});
    q.questions[0]!.id = other.poll.questions[0]!.id;
    await expect(w.call("polls.update", w.alice, { pollId: poll.id, poll: q })).rejects.toThrow(
      ValidationError,
    );
    // The edit input has no kind or anonymous: they stay as made.
    const same = await w.call("polls.update", w.alice, { pollId: poll.id, poll: edit(poll) });
    expect(same).toMatchObject({ kind: "poll", anonymous: true });
  });

  test("a locked thread takes the creator's edit away, not staff's", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(w, w.alice);
    await w.call("threads.setLocked", w.mod, { threadId, isLocked: true });
    await expect(
      w.call("polls.update", w.alice, { pollId: poll.id, poll: edit(poll) }),
    ).rejects.toThrow(ForbiddenError);
    await w.call("polls.update", w.mod, { pollId: poll.id, poll: edit(poll) });
  });

  test("deleting: the creator while nobody voted, staff any time", async () => {
    const w = world();
    const first = await withPoll(w, w.alice, colours(), "First");
    await w.call("polls.delete", w.alice, { pollId: first.poll.id });
    expect((await w.call("polls.get", w.alice, { threadId: first.threadId })).poll).toBeNull();
    const second = await withPoll(w, w.alice, colours(), "Second");
    await vote(w, w.bob, second.poll, [answerIds(second.poll)[0]!]);
    await expect(w.call("polls.delete", w.alice, { pollId: second.poll.id })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(w.call("polls.delete", w.bob, { pollId: second.poll.id })).rejects.toThrow(
      ForbiddenError,
    );
    expect(pollVoteCount(w, w.bobUser.id)).toBe(1);
    await w.call("polls.delete", w.mod, { pollId: second.poll.id, reason: "Gone" });
    for (const table of ["polls", "poll_questions", "poll_answers", "poll_votes", "poll_ballots"])
      expect(w.ctx.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    expect(pollVoteCount(w, w.bobUser.id)).toBe(0);
    // A new poll can take its place.
    await w.call("polls.create", w.alice, { threadId: second.threadId, poll: colours() });
    const log = w.ctx.sqlite
      .prepare<{ action: string; details: string }, []>(
        "SELECT action, details FROM moderator_log WHERE action = 'poll.delete'",
      )
      .all();
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0]!.details)).toMatchObject({ kind: "poll", ballots: 1 });
  });

  test("a stranger to the forum finds no poll to touch", async () => {
    const w = world();
    const hidden = await w.call("threads.create", w.admin, {
      nodeId: w.secret.id,
      title: "Staff",
      body: "B",
      poll: colours(),
    });
    const poll = (await w.call("polls.get", w.admin, { threadId: hidden.thread.id })).poll;
    for (const [name, input] of [
      ["polls.close", { pollId: poll.id, closed: true }],
      ["polls.delete", { pollId: poll.id }],
      ["polls.definition", { pollId: poll.id }],
      ["polls.update", { pollId: poll.id, poll: edit(poll) }],
    ] as const)
      await expect(w.call(name, w.bob, input)).rejects.toThrow(NotFoundError);
    await expect(w.call("polls.close", w.bob, { pollId: 999_999, closed: true })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("a hand-made group", () => {
  test("holds exactly what it was given", async () => {
    const w = world();
    const { poll, threadId } = await withPoll(w, w.alice);
    const [red] = answerIds(poll);
    const reader = customMember(w.ctx, ["site.view", "node.view"]);
    const seen = (await w.call("polls.get", reader.actor, { threadId })).poll;
    expect(seen.permissions).toEqual({
      canVote: false,
      canAddAnswer: false,
      canEdit: false,
      canDelete: false,
      canClose: false,
      canViewVoters: false,
    });
    await expect(vote(w, reader.actor, poll, [red!])).rejects.toThrow(ForbiddenError);
    const manager = customMember(w.ctx, ["site.view", "node.view", "poll.manage"]);
    await w.call("polls.close", w.mod, { pollId: poll.id, closed: false });
    const managed = (await w.call("polls.get", manager.actor, { threadId })).poll;
    expect(managed.permissions).toMatchObject({ canEdit: true, canDelete: true, canClose: false });
    expect(actorUserId(manager.actor)).not.toBe(w.aliceUser.id);
    const closer = customMember(w.ctx, ["site.view", "node.view", "poll.closeAny"]);
    await w.call("polls.close", closer.actor, { pollId: poll.id, closed: true });
  });
});
