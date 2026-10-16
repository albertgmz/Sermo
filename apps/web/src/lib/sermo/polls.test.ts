import { expect, test } from "bun:test";
import {
  blankDraft,
  type DraftAnswer,
  type DraftQuestion,
  draftFromDefinition,
  draftToInput,
  draftToJson,
  mergeFresh,
  type PollDefinitionView,
  type PollDraft,
  percentOf,
  pollForClient,
  pollFromJson,
  toLocalInput,
} from "./polls";

// The first question of a draft, and its answers: the drafts here always have them.
function question(draft: PollDraft): DraftQuestion {
  const found = draft.questions[0];
  if (!found) throw new Error("no question");
  return found;
}
function answer(draft: PollDraft, at: number): DraftAnswer {
  const found = question(draft).answers[at];
  if (!found) throw new Error("no answer");
  return found;
}
const answer_ = (q: DraftQuestion, at: number): DraftAnswer => {
  const found = q.answers[at];
  if (!found) throw new Error("no answer");
  return found;
};
const sentAnswers = (draft: PollDraft) =>
  draftToInput(draft).questions[0]?.answers ?? [];

function written(text: string): PollDraft {
  const draft = blankDraft();
  question(draft).text = text;
  for (const [i, item] of question(draft).answers.entries())
    item.text = `A${i}`;
  return draft;
}

test("a blank poll asks one question and offers three answers", () => {
  const draft = blankDraft();
  expect(draft.kind).toBe("poll");
  expect(draft.questions).toHaveLength(1);
  expect(question(draft).answers).toHaveLength(3);
});

test("blank new answers are not sent, existing ones are", () => {
  const draft = blankDraft();
  question(draft).text = "Best colour?";
  answer(draft, 0).text = "Red";
  answer(draft, 1).text = "Blue";
  question(draft).answers[2] = {
    id: 9,
    text: "",
    correct: false,
    picture: null,
  };
  expect(sentAnswers(draft).map((a) => a.text)).toEqual(["Red", "Blue", ""]);
  question(draft).answers.pop();
  expect(sentAnswers(draft)).toHaveLength(2);
});

test("a poll sends no right answers and no explanations, a quiz does", () => {
  const draft = written("Q");
  question(draft).explanation = "Because";
  const poll = draftToInput(draft);
  expect(poll.questions[0]?.explanation).toBe("");
  expect(sentAnswers(draft).every((a) => a.correct === false)).toBe(true);
  const quiz = draftToInput({
    ...draft,
    kind: "quiz",
    maxChoices: 3,
    allowCustom: true,
  });
  expect(quiz.maxChoices).toBe(1);
  expect(quiz.allowCustom).toBe(false);
  expect(quiz.questions[0]?.explanation).toBe("Because");
  expect(quiz.questions[0]?.answers.map((a) => a.correct)).toEqual([
    true,
    false,
    false,
  ]);
});

test("the close date travels as an ISO time, none as null", () => {
  const draft = blankDraft();
  expect(draftToInput(draft).closesAt).toBeNull();
  draft.closesAt = "2030-05-06T07:08";
  const iso = draftToInput(draft).closesAt;
  expect(new Date(iso ?? "").getFullYear()).toBe(2030);
  expect(toLocalInput(iso ?? null)).toBe("2030-05-06T07:08");
  expect(toLocalInput(null)).toBe("");
});

test("the JSON field is read back, and what is no object is no poll", () => {
  const read = pollFromJson(draftToJson(written("Q")));
  expect(read?.kind).toBe("poll");
  for (const bad of ["", "   ", "nope", "[]", "3", "null"])
    expect(pollFromJson(bad)).toBeNull();
});

test("a definition becomes a draft that keeps ids, pictures and what voters added", () => {
  const definition: PollDefinitionView = {
    id: 5,
    threadId: 2,
    kind: "quiz",
    anonymous: false,
    maxChoices: 1,
    allowCustom: false,
    allowChange: false,
    results: "always",
    closesAt: null,
    ballotCount: 2,
    updatedAt: "2026-01-01T00:00:00.000Z",
    questions: [
      {
        id: 11,
        text: "Q",
        explanation: "Why",
        image: { fileId: 70 },
        answers: [
          {
            id: 21,
            text: "A",
            image: null,
            correct: true,
            custom: false,
            votes: 1,
          },
          {
            id: 22,
            text: "B",
            image: null,
            correct: false,
            custom: true,
            votes: 0,
          },
        ],
      },
    ],
  };
  const draft = draftFromDefinition(definition);
  expect(question(draft)).toMatchObject({
    id: 11,
    explanation: "Why",
    picture: { fileId: 70 },
  });
  expect(answer(draft, 1)).toMatchObject({ id: 22, custom: true });
  const sent = draftToInput(draft);
  expect(sent.questions[0]).toMatchObject({ id: 11, imageFileId: 70 });
  expect(sentAnswers(draft).map((a) => a.id)).toEqual([21, 22]);
});

test("a share is a whole percent of the whole, nothing of nothing", () => {
  expect(percentOf(1, 3)).toBe(33);
  expect(percentOf(2, 3)).toBe(67);
  expect(percentOf(0, 0)).toBe(0);
});

test("a vote never picks more answers than are listed once blank rows are dropped", () => {
  const draft = written("Q");
  draft.maxChoices = 3;
  expect(draftToInput(draft).maxChoices).toBe(3);
  question(draft).answers.pop();
  question(draft).answers.push({ text: "", correct: false, picture: null });
  expect(draftToInput(draft).maxChoices).toBe(2);
});

test("a close date left alone is sent as the backend gave it, a changed one is not", () => {
  const draft = blankDraft();
  const was = "2030-05-06T07:08:09.123Z";
  draft.closesAt = toLocalInput(was);
  draft.closesAtWas = was;
  expect(draftToInput(draft).closesAt).toBe(was);
  draft.closesAt = "2031-01-02T03:04";
  expect(draftToInput(draft).closesAt).toBe(
    new Date("2031-01-02T03:04").toISOString(),
  );
  draft.closesAt = "";
  expect(draftToInput(draft).closesAt).toBeNull();
});

test("the form keeps the version of the definition it started from", () => {
  const draft = draftFromDefinition({
    id: 5,
    threadId: 2,
    kind: "poll",
    anonymous: false,
    maxChoices: 1,
    allowCustom: false,
    allowChange: true,
    results: "always",
    closesAt: null,
    ballotCount: 0,
    updatedAt: "2026-02-03T04:05:06.007Z",
    questions: [],
  });
  expect(draft.loadedAt).toBe("2026-02-03T04:05:06.007Z");
  // It is not part of what is sent for the poll.
  expect(JSON.stringify(draftToInput(draft))).not.toContain("2026-02-03");
});

test("a poll reaches the client with the file ids of its pictures and no address", () => {
  const picture = {
    fileId: 70,
    url: "/api/v1/files/70",
    contentType: "image/png",
    byteSize: 1,
    width: 1,
    height: 1,
    thumbnailUrl: "/api/v1/files/71",
  };
  const poll = pollForClient({
    id: 1,
    threadId: 2,
    kind: "poll",
    anonymous: false,
    maxChoices: 1,
    allowCustom: false,
    allowChange: true,
    results: "always",
    closesAt: null,
    closed: false,
    answerMaxLength: 100,
    resultsShown: true,
    voterCount: 0,
    questions: [
      {
        id: 3,
        text: "Q",
        image: picture,
        explanation: null,
        answered: false,
        answers: [
          {
            id: 4,
            text: "A",
            image: picture,
            votes: 0,
            chosen: false,
            correct: null,
            custom: false,
          },
          {
            id: 5,
            text: "B",
            image: null,
            votes: 0,
            chosen: false,
            correct: null,
            custom: false,
          },
        ],
      },
    ],
    mine: { voted: false, answered: 0, correct: 0, completed: false },
    permissions: {
      canVote: true,
      canAddAnswer: false,
      canEdit: false,
      canDelete: false,
      canClose: false,
      canViewVoters: false,
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  expect(poll.questions[0]?.image).toEqual({ fileId: 70 });
  expect(poll.questions[0]?.answers[0]?.image).toEqual({ fileId: 70 });
  expect(poll.questions[0]?.answers[1]?.image).toBeNull();
  expect(JSON.stringify(poll)).not.toMatch(/files|thumbnail|url/);
});

test("what changed meanwhile is taken into the form without touching what was typed", () => {
  const base = {
    id: 5,
    threadId: 2,
    kind: "poll" as const,
    anonymous: false,
    maxChoices: 1,
    allowCustom: true,
    allowChange: true,
    results: "always" as const,
    closesAt: null,
    ballotCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const answer = (id: number, text: string, custom = false) => ({
    id,
    text,
    image: null,
    correct: false,
    custom,
    votes: 0,
  });
  const loaded: PollDefinitionView = {
    ...base,
    questions: [
      {
        id: 1,
        text: "Q",
        explanation: "",
        image: null,
        answers: [answer(11, "Red"), answer(12, "Blue"), answer(13, "Green")],
      },
    ],
  };
  const draft = draftFromDefinition(loaded);
  // The member rewords one answer and removes another.
  const typed = question(draft);
  typed.text = "My question";
  typed.answers = typed.answers.filter((a) => a.id !== 12);
  answer_(typed, 0).text = "Crimson";
  const fresh: PollDefinitionView = {
    ...base,
    updatedAt: "2026-01-02T00:00:00.000Z",
    questions: [
      {
        id: 1,
        text: "Q",
        explanation: "",
        image: null,
        answers: [
          answer(11, "Red"),
          answer(12, "Blue"),
          answer(13, "Green"),
          answer(14, "Pink", true),
        ],
      },
    ],
  };
  const merged = mergeFresh(draft, fresh);
  expect(question(merged).text).toBe("My question");
  expect(question(merged).answers.map((a) => a.text)).toEqual([
    "Crimson",
    "Green",
    "Pink",
  ]);
  expect(question(merged).answers[2]).toMatchObject({ id: 14, custom: true });
  expect(merged.loadedAt).toBe("2026-01-02T00:00:00.000Z");
  // Taken in once, it is not taken in again.
  expect(question(mergeFresh(merged, fresh)).answers).toHaveLength(3);
});
