import { expect, test } from "bun:test";
import {
  blankDraft,
  type DraftAnswer,
  type DraftQuestion,
  draftFromDefinition,
  draftToInput,
  draftToJson,
  type PollDefinitionView,
  type PollDraft,
  percentOf,
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
    questions: [
      {
        id: 11,
        text: "Q",
        explanation: "Why",
        image: {
          fileId: 70,
          url: "/api/v1/files/70",
          contentType: "image/png",
          byteSize: 1,
          width: 1,
          height: 1,
          thumbnailUrl: null,
        },
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
