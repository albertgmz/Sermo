import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { world } from "../feed/fixtures.test";
import { customMember, setEntry } from "../permissions/group-fixture";
import { answerIds, colours, withPoll } from "./fixtures.test";

const GRANTS = [
  "site.view",
  "node.view",
  "forum.createThread",
  "poll.create",
  "poll.vote",
  "poll.addAnswer",
  "poll.closeOwn",
];

/**
 * A member of a hand-made group who made a poll, resolved in one process (`here`) while another
 * (`elsewhere`) takes one permission away: the write must be refused in the transaction, from the
 * member's permissions as they are now, and change nothing.
 */
async function scenario() {
  const w = world();
  const member = customMember(w.ctx, GRANTS);
  const { poll, threadId } = await withPoll(
    w,
    member.actor,
    colours({ allowCustom: true }),
    "Mine",
  );
  const plain = await w.call("threads.create", member.actor, {
    nodeId: w.open.id,
    title: "Plain",
    body: "Body",
  });
  const database = sharedDatabase(w.ctx);
  const here = database.open();
  const elsewhere = database.open();
  const actor = resolvedActor(here, member.row.id);
  // Warm: this process has read what the member may do.
  await execute(here, getOperation("polls.get"), actor, { threadId });
  return { w, member, poll, plain, database, here, elsewhere, actor };
}

type Scenario = Awaited<ReturnType<typeof scenario>>;
const questionOf = (s: Scenario) => s.poll.questions[0];

const attempts: [string, string, (s: Scenario) => [string, object]][] = [
  [
    "polls.create",
    "poll.create",
    (s) => ["polls.create", { threadId: s.plain.thread.id, poll: colours() }],
  ],
  [
    "polls.update",
    "poll.create",
    (s) => [
      "polls.update",
      {
        pollId: s.poll.id,
        poll: {
          ...colours(),
          questions: [
            {
              id: questionOf(s)?.id,
              text: "Changed?",
              answers: questionOf(s)?.answers.map((a) => ({ id: a.id, text: a.text })),
            },
          ],
        },
      },
    ],
  ],
  [
    "polls.vote",
    "poll.vote",
    (s) => [
      "polls.vote",
      {
        pollId: s.poll.id,
        questionId: questionOf(s)?.id,
        answerIds: [answerIds(s.poll)[0]],
      },
    ],
  ],
  [
    "polls.addAnswer",
    "poll.addAnswer",
    (s) => ["polls.addAnswer", { pollId: s.poll.id, text: "Mine" }],
  ],
  ["polls.close", "poll.closeOwn", (s) => ["polls.close", { pollId: s.poll.id, closed: true }]],
];

const snapshot = (s: Scenario) =>
  JSON.stringify([
    s.elsewhere.sqlite
      .prepare("SELECT id, kind, closed_at, search_text FROM polls ORDER BY id")
      .all(),
    s.elsewhere.sqlite.prepare("SELECT id, text FROM poll_answers ORDER BY id").all(),
    s.elsewhere.sqlite.prepare("SELECT id, text FROM poll_questions ORDER BY id").all(),
    s.elsewhere.sqlite.prepare("SELECT id FROM poll_votes ORDER BY id").all(),
    s.elsewhere.sqlite.prepare("SELECT id FROM poll_ballots ORDER BY id").all(),
  ]);

describe("a poll write is judged on the member's permissions as they are in its transaction", () => {
  for (const [name, permission, attempt] of attempts)
    test(`${name} is refused when ${permission} was taken away meanwhile`, async () => {
      const s = await scenario();
      try {
        const [operation, input] = attempt(s);
        // Allowed before the change (the member may do it in this process).
        setEntry(s.elsewhere, s.member.groupId, permission, 0);
        const before = snapshot(s);
        await expect(execute(s.here, getOperation(operation), s.actor, input)).rejects.toThrow(
          ForbiddenError,
        );
        expect(snapshot(s)).toBe(before);
      } finally {
        s.database.close();
      }
    });

  test("a member banned meanwhile cannot vote either", async () => {
    const s = await scenario();
    try {
      await execute(s.elsewhere, getOperation("bans.create"), s.w.admin, {
        userId: s.member.row.id,
        reason: "Abuse",
        expiresAt: null,
      });
      const before = snapshot(s);
      await expect(
        execute(s.here, getOperation("polls.vote"), s.actor, {
          pollId: s.poll.id,
          questionId: questionOf(s)?.id,
          answerIds: [answerIds(s.poll)[0]],
        }),
      ).rejects.toThrow();
      expect(snapshot(s)).toBe(before);
    } finally {
      s.database.close();
    }
  });
});

test("threads.get says whether a thread has a poll and whether the viewer may add one", async () => {
  const w = world();
  const plain = await w.thread(w.alice, w.open.id, "Plain");
  const polled = await withPoll(w, w.alice);
  const facts = async (actor: typeof w.alice, threadId: number) =>
    (await w.call("threads.get", actor, { threadId })).poll;
  expect(await facts(w.alice, plain.thread.id)).toEqual({ exists: false, canAdd: true });
  expect(await facts(w.bob, plain.thread.id)).toEqual({ exists: false, canAdd: false });
  expect(await facts(w.mod, plain.thread.id)).toEqual({ exists: false, canAdd: true });
  expect(await facts(w.alice, polled.threadId)).toEqual({ exists: true, canAdd: false });
  expect(await facts(w.bob, polled.threadId)).toEqual({ exists: true, canAdd: false });
  // A viewer who may not read the posts is told of none.
  setEntry(w.ctx, 2, "forum.viewContent", -1, w.open.id);
  expect(await facts(w.bob, polled.threadId)).toEqual({ exists: false, canAdd: false });
  expect(await facts(w.alice, polled.threadId)).toEqual({ exists: true, canAdd: false });
});
