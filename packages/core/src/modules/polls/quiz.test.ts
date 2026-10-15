import { describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { ConflictError, ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { type World, world } from "../feed/fixtures.test";
import { customMember } from "../permissions/group-fixture";
import type {
  AnswerValue,
  DefinitionValue,
  EditInput,
  PollValue,
  QuestionValue,
} from "./fixtures.test";

type Q = { text: string; right: string; wrong: string[]; explanation?: string };
const QUESTIONS: Q[] = [
  { text: "Capital of France?", right: "Paris", wrong: ["Lyon", "Nice"], explanation: "Seine." },
  { text: "Two plus two?", right: "Four", wrong: ["Three", "Five"], explanation: "Arithmetic." },
  { text: "Largest planet?", right: "Jupiter", wrong: ["Mars"], explanation: "Gas giant." },
];

const quizInput = (questions: Q[] = QUESTIONS, over: object = {}) => ({
  kind: "quiz",
  questions: questions.map((q) => ({
    text: q.text,
    explanation: q.explanation ?? "",
    answers: [
      { text: q.wrong[0]! },
      { text: q.right, correct: true },
      ...q.wrong.slice(1).map((text) => ({ text })),
    ],
  })),
  ...over,
});

async function quiz(w: World, actor: World["alice"] = w.alice, questions: Q[] = QUESTIONS) {
  w.ctx.clock.advance(60_000);
  const created = await w.call("threads.create", actor, {
    nodeId: w.open.id,
    title: "A quiz",
    body: "Take it.",
    poll: quizInput(questions),
  });
  const { poll } = await w.call("polls.get", actor, { threadId: created.thread.id });
  return { threadId: created.thread.id as number, poll };
}

const answer = (w: World, actor: World["alice"], poll: PollValue, q: number, text: string) => {
  const found = poll.questions[q]!.answers.find((a: AnswerValue) => a.text === text);
  return w.call("polls.vote", actor, {
    pollId: poll.id,
    questionId: poll.questions[q]!.id,
    answerIds: [found!.id],
  });
};
const read = async (w: World, actor: World["alice"], threadId: number): Promise<PollValue> =>
  (await w.call("polls.get", actor, { threadId })).poll;
const corrects = (poll: PollValue) => poll.questions.map((q) => q.answers.map((a) => a.correct));
const explained = (poll: PollValue) => poll.questions.map((q) => q.explanation);

/** Whatever the viewer has not answered must carry no right answer, no explanation, no count. */
function expectNoLeak(poll: PollValue, answered: number[] = []) {
  poll.questions.forEach((question: QuestionValue, index: number) => {
    expect(question.answered).toBe(answered.includes(index));
    for (const a of question.answers) {
      expect(a.votes).toBeNull();
      if (!answered.includes(index)) expect(a.correct).toBeNull();
    }
    if (!answered.includes(index)) expect(question.explanation).toBeNull();
  });
}

describe("a quiz never gives its answers away", () => {
  test("not to anyone who has not answered: members, guests, its creator, staff", async () => {
    const w = world();
    const { threadId } = await quiz(w);
    for (const actor of [w.bob, GUEST, w.alice, w.mod, w.admin]) {
      const poll = await read(w, actor, threadId);
      expectNoLeak(poll);
      expect(
        corrects(poll)
          .flat()
          .every((c: unknown) => c === null),
      ).toBe(true);
      const text = JSON.stringify(poll);
      for (const q of QUESTIONS) expect(text).not.toContain(q.explanation!);
    }
  });

  test("an answer shows the right answer and the explanation of that question only", async () => {
    const w = world();
    const { poll, threadId } = await quiz(w);
    const second: PollValue = await answer(w, w.bob, poll, 1, "Three");
    expectNoLeak(second, [1]);
    expect(corrects(second)[1]).toEqual([false, true, false]);
    expect(explained(second)).toEqual([null, "Arithmetic.", null]);
    expect(second.questions[1]!.answers.find((a) => a.text === "Three")?.chosen).toBe(true);
    expect(second.mine).toMatchObject({ voted: true, answered: 1, correct: 0, completed: false });
    // What bob knows is bob's: another member's page is unchanged.
    expectNoLeak(await read(w, w.carol, threadId));
    expectNoLeak(await read(w, GUEST, threadId));
    expectNoLeak(await read(w, w.alice, threadId));
    // Reading again later gives bob the same.
    expectNoLeak(await read(w, w.bob, threadId), [1]);
    expect(corrects(await read(w, w.bob, threadId))[0]).toEqual([null, null, null]);
  });

  test("the vote counts of a quiz are never sent, even to staff and when it is closed", async () => {
    const w = world();
    const { poll, threadId } = await quiz(w);
    await answer(w, w.bob, poll, 0, "Paris");
    await w.call("polls.close", w.alice, { pollId: poll.id, closed: true });
    for (const actor of [w.alice, w.mod, w.carol, GUEST]) {
      const seen = await read(w, actor, threadId);
      for (const q of seen.questions) for (const a of q.answers) expect(a.votes).toBeNull();
      expect(seen.voterCount).toBe(1);
    }
  });

  test("voters are never listed for a quiz", async () => {
    const w = world();
    const { poll } = await quiz(w);
    await answer(w, w.bob, poll, 0, "Paris");
    await expect(
      w.call("polls.voters", w.admin, {
        pollId: poll.id,
        answerId: poll.questions[0]!.answers[0].id,
      }),
    ).rejects.toThrow(ForbiddenError);
    expect((await read(w, w.bob, poll.threadId)).permissions.canViewVoters).toBe(false);
  });

  test("the editor's view is for editors only", async () => {
    const w = world();
    const { poll } = await quiz(w);
    await expect(w.call("polls.definition", w.bob, { pollId: poll.id })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(w.call("polls.definition", GUEST, { pollId: poll.id })).rejects.toThrow();
    for (const actor of [w.alice, w.mod]) {
      const definition: DefinitionValue = await w.call("polls.definition", actor, {
        pollId: poll.id,
      });
      expect(definition.kind).toBe("quiz");
      expect(
        definition.questions.map(
          (q: DefinitionValue["questions"][number]) => q.answers.find((a) => a.correct)?.text,
        ),
      ).toEqual(["Paris", "Four", "Jupiter"]);
      expect(
        definition.questions.map((q: DefinitionValue["questions"][number]) => q.explanation),
      ).toEqual(["Seine.", "Arithmetic.", "Gas giant."]);
    }
  });
});

describe("taking a quiz", () => {
  test("a score kept with the member, complete after the last answer", async () => {
    const w = world();
    const { poll, threadId } = await quiz(w);
    const one = await answer(w, w.bob, poll, 0, "Paris");
    expect(one.mine).toMatchObject({ answered: 1, correct: 1, completed: false });
    const two = await answer(w, w.bob, poll, 1, "Five");
    expect(two.mine).toMatchObject({ answered: 2, correct: 1, completed: false });
    const three = await answer(w, w.bob, poll, 2, "Jupiter");
    expect(three.mine).toMatchObject({ answered: 3, correct: 2, completed: true });
    expect(corrects(three)).toEqual([
      [false, true, false],
      [false, true, false],
      [false, true],
    ]);
    // Kept: it is still there tomorrow.
    w.ctx.clock.advance(86_400_000);
    expect((await read(w, w.bob, threadId)).mine).toMatchObject({
      answered: 3,
      correct: 2,
      completed: true,
    });
    // Another member's result is their own.
    const carol = await answer(w, w.carol, poll, 0, "Lyon");
    expect(carol.mine).toMatchObject({ answered: 1, correct: 0 });
    expect(w.ctx.sqlite.prepare("SELECT ballot_count FROM polls").get()).toEqual({
      ballot_count: 2,
    });
    expect(
      w.ctx.sqlite
        .prepare("SELECT user_id, answered, score FROM poll_ballots ORDER BY user_id")
        .all(),
    ).toEqual([
      { user_id: w.bobUser.id, answered: 3, score: 2 },
      { user_id: w.carolUser.id, answered: 1, score: 0 },
    ]);
  });

  test("an answer is final: no second try, no change, no retake", async () => {
    const w = world();
    const { poll } = await quiz(w);
    await answer(w, w.bob, poll, 0, "Lyon");
    await expect(answer(w, w.bob, poll, 0, "Paris")).rejects.toThrow(ConflictError);
    await expect(answer(w, w.bob, poll, 0, "Lyon")).rejects.toThrow(ConflictError);
    const score = w.ctx.sqlite.prepare("SELECT answered, score FROM poll_ballots").get();
    expect(score).toEqual({ answered: 1, score: 0 });
    expect(poll.allowChange).toBe(false);
  });

  test("one answer a question, from that question", async () => {
    const w = world();
    const { poll } = await quiz(w);
    const q0 = poll.questions[0];
    const q1 = poll.questions[1];
    await expect(
      w.call("polls.vote", w.bob, {
        pollId: poll.id,
        questionId: q0.id,
        answerIds: [q0.answers[0].id, q0.answers[1].id],
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      w.call("polls.vote", w.bob, {
        pollId: poll.id,
        questionId: q0.id,
        answerIds: [q1.answers[0].id],
      }),
    ).rejects.toThrow(ValidationError);
    expect(w.ctx.sqlite.prepare("SELECT count(*) AS n FROM poll_votes").get()).toEqual({ n: 0 });
  });

  test("a closed quiz takes no answer; guests and members without poll.vote cannot answer", async () => {
    const w = world();
    const { poll } = await quiz(w);
    await expect(answer(w, GUEST, poll, 0, "Paris")).rejects.toThrow(UnauthenticatedError);
    const none = customMember(w.ctx, ["site.view", "node.view"]);
    await expect(answer(w, none.actor, poll, 0, "Paris")).rejects.toThrow(ForbiddenError);
    await w.call("polls.close", w.mod, { pollId: poll.id, closed: true });
    await expect(answer(w, w.bob, poll, 0, "Paris")).rejects.toThrow(ConflictError);
    await w.call("polls.close", w.mod, { pollId: poll.id, closed: false });
    await answer(w, w.bob, poll, 0, "Paris");
  });

  test("a one-question quiz is complete with its answer", async () => {
    const w = world();
    const { poll } = await quiz(w, w.alice, [QUESTIONS[0]!]);
    const done = await answer(w, w.bob, poll, 0, "Paris");
    expect(done.mine).toMatchObject({ answered: 1, correct: 1, completed: true });
  });

  test("answering counts the member as having taken part, once", async () => {
    const w = world();
    const { poll } = await quiz(w);
    await answer(w, w.bob, poll, 0, "Paris");
    await answer(w, w.bob, poll, 1, "Four");
    expect(
      w.ctx.sqlite.prepare("SELECT poll_vote_count FROM users WHERE id = ?1").get(w.bobUser.id),
    ).toEqual({ poll_vote_count: 1 });
  });
});

describe("what a quiz must hold, and what changes once it was taken", () => {
  const make = (w: World, poll: object) =>
    w.call("threads.create", w.alice, { nodeId: w.open.id, title: "Q", body: "B", poll });

  test("one right answer a question, at most eight answers, no custom answers", async () => {
    const w = world();
    const base = quizInput();
    const noRight = quizInput([{ text: "Q", right: "A", wrong: ["B"] }]);
    noRight.questions[0]!.answers[1]!.correct = false;
    await expect(make(w, noRight)).rejects.toThrow(ValidationError);
    const two = quizInput([{ text: "Q", right: "A", wrong: ["B"] }]);
    two.questions[0]!.answers[0]!.correct = true;
    await expect(make(w, two)).rejects.toThrow(ValidationError);
    const nine = quizInput([
      { text: "Q", right: "R", wrong: Array.from({ length: 8 }, (_, i) => `W${i}`) },
    ]);
    await expect(make(w, nine)).rejects.toThrow(ValidationError);
    await expect(make(w, { ...base, allowCustom: true })).rejects.toThrow(ValidationError);
    const many = quizInput(
      Array.from({ length: 21 }, (_, i) => ({ text: `Q${i}`, right: "A", wrong: ["B"] })),
    );
    await expect(make(w, many)).rejects.toThrow(ValidationError);
    expect((await make(w, base)).thread.id).toBeGreaterThan(0);
  });

  const edit = (definition: DefinitionValue, change: (input: EditInput) => void) => {
    const input: EditInput = {
      maxChoices: 1,
      allowCustom: false,
      allowChange: false,
      results: definition.results,
      closesAt: definition.closesAt,
      questions: definition.questions.map((q) => ({
        id: q.id,
        text: q.text,
        explanation: q.explanation,
        answers: q.answers.map((a) => ({ id: a.id, text: a.text, correct: a.correct })),
      })),
    };
    change(input);
    return input;
  };

  test("before anyone takes it: anything may change", async () => {
    const w = world();
    const { poll } = await quiz(w);
    const definition: DefinitionValue = await w.call("polls.definition", w.alice, {
      pollId: poll.id,
    });
    const updated = await w.call("polls.update", w.alice, {
      pollId: poll.id,
      poll: edit(definition, (input) => {
        input.questions[0]!.answers[0]!.correct = true;
        input.questions[0]!.answers[1]!.correct = false;
        input.questions.pop();
        input.questions[0]!.answers.push({ text: "Rouen" });
      }),
    });
    expect(updated.questions).toHaveLength(2);
    expect(updated.questions[0]!.answers).toHaveLength(4);
    const after: DefinitionValue = await w.call("polls.definition", w.alice, { pollId: poll.id });
    expect(after.questions[0]!.answers.find((a) => a.correct)?.text).toBe("Lyon");
  });

  test("once taken: texts and explanations only, for the creator and for staff", async () => {
    const w = world();
    const { poll } = await quiz(w);
    await answer(w, w.bob, poll, 0, "Paris");
    const definition: DefinitionValue = await w.call("polls.definition", w.alice, {
      pollId: poll.id,
    });
    const structural: [string, (input: EditInput) => void][] = [
      [
        "a right answer moved",
        (i) => {
          i.questions[0]!.answers[0]!.correct = true;
          i.questions[0]!.answers[1]!.correct = false;
        },
      ],
      ["an answer added", (i) => i.questions[0]!.answers.push({ text: "Rouen" })],
      ["an answer removed", (i) => i.questions[0]!.answers.pop()],
      ["a question removed", (i) => i.questions.pop()],
      [
        "a question added",
        (i) =>
          i.questions.push({
            text: "New?",
            answers: [{ text: "A", correct: true }, { text: "B" }],
          }),
      ],
    ];
    for (const actor of [w.alice, w.mod])
      for (const [, change] of structural)
        await expect(
          w.call("polls.update", actor, { pollId: poll.id, poll: edit(definition, change) }),
        ).rejects.toThrow(ConflictError);
    const reworded = await w.call("polls.update", w.mod, {
      pollId: poll.id,
      poll: edit(definition, (input) => {
        input.questions[0]!.text = "What is the capital of France?";
        input.questions[0]!.explanation = "On the Seine.";
        input.questions[0]!.answers[0]!.text = "Lyons";
      }),
    });
    // The member's answer stands, the score with it.
    expect(reworded.questions[0].text).toBe("What is the capital of France?");
    expect(reworded.mine.correct).toBe(0);
    expect((await read(w, w.bob, poll.threadId)).mine.correct).toBe(1);
    expect(explained(await read(w, w.bob, poll.threadId))[0]).toBe("On the Seine.");
  });

  test("a quiz of a taker is deleted by staff, with the score", async () => {
    const w = world();
    const { poll } = await quiz(w);
    await answer(w, w.bob, poll, 0, "Paris");
    await expect(w.call("polls.delete", w.alice, { pollId: poll.id })).rejects.toThrow(
      ForbiddenError,
    );
    await w.call("polls.delete", w.admin, { pollId: poll.id });
    expect(w.ctx.sqlite.prepare("SELECT count(*) AS n FROM poll_ballots").get()).toEqual({ n: 0 });
  });
});
