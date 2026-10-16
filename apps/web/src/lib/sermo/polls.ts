import type { Poll, PollDefinition, PollInput } from "@sermo/core/contracts";
import type { z } from "zod";

// What a poll or quiz looks like to the screens, and the draft the creator's form holds. The
// backend decides every rule (sizes, counts, who may); nothing here judges a text or a limit.
// The client is given only what it draws. A picture reaches it as its file id, which is the key of
// the picture the server drew (through the data saver's gate) and what an editor names to keep it;
// never as an address: where the data saver blocks pictures no address is written for the browser.
export type ContractPoll = z.infer<typeof Poll>;
type ContractDefinition = z.infer<typeof PollDefinition>;
type Picture = { fileId: number } | null;
export type PollView = Omit<ContractPoll, "questions"> & {
  questions: (Omit<ContractPoll["questions"][number], "image" | "answers"> & {
    image: Picture;
    answers: (Omit<
      ContractPoll["questions"][number]["answers"][number],
      "image"
    > & {
      image: Picture;
    })[];
  })[];
};
export type PollDefinitionView = Omit<ContractDefinition, "questions"> & {
  questions: (Omit<
    ContractDefinition["questions"][number],
    "image" | "answers"
  > & {
    image: Picture;
    answers: (Omit<
      ContractDefinition["questions"][number]["answers"][number],
      "image"
    > & {
      image: Picture;
    })[];
  })[];
};
export type PollQuestionView = PollView["questions"][number];
export type PollAnswerView = PollQuestionView["answers"][number];

const idOf = (image: { fileId: number } | null): Picture =>
  image ? { fileId: image.fileId } : null;

// A poll as the backend gave it, cut down to what the screens draw (no picture address).
export function pollForClient(poll: ContractPoll): PollView {
  return {
    ...poll,
    questions: poll.questions.map((question) => ({
      ...question,
      image: idOf(question.image),
      answers: question.answers.map((answer) => ({
        ...answer,
        image: idOf(answer.image),
      })),
    })),
  };
}

export function definitionForClient(
  definition: ContractDefinition,
): PollDefinitionView {
  return {
    ...definition,
    questions: definition.questions.map((question) => ({
      ...question,
      image: idOf(question.image),
      answers: question.answers.map((answer) => ({
        ...answer,
        image: idOf(answer.image),
      })),
    })),
  };
}
type PollInputValue = z.input<typeof PollInput>;

// A picture the creator chose: the id of the uploaded file, and its name to show in the form.
export type DraftPicture = { fileId: number; name: string };

export type DraftAnswer = {
  // Set on an answer the poll already has.
  id?: number;
  text: string;
  correct: boolean;
  picture: DraftPicture | null;
  // A voter added it, and how many chose it (shown, never sent).
  custom?: boolean;
  votes?: number;
};

export type DraftQuestion = {
  id?: number;
  text: string;
  explanation: string;
  picture: DraftPicture | null;
  answers: DraftAnswer[];
};

export type PollDraft = {
  kind: "poll" | "quiz";
  anonymous: boolean;
  maxChoices: number;
  allowCustom: boolean;
  allowChange: boolean;
  results: "always" | "after_vote" | "after_close";
  // A `datetime-local` value, in the browser's time zone; empty for none.
  closesAt: string;
  // The close date the poll has now, as the backend gave it: sent back as it was while the field is
  // left alone, since the field holds no seconds.
  closesAtWas?: string;
  // When the definition the form started from was last changed: sent back, so a save over a newer
  // one (an answer a voter added) is refused instead of deleting it.
  loadedAt?: string;
  questions: DraftQuestion[];
};

export const blankAnswer = (): DraftAnswer => ({
  text: "",
  correct: false,
  picture: null,
});

export const blankQuestion = (): DraftQuestion => ({
  text: "",
  explanation: "",
  picture: null,
  answers: [{ ...blankAnswer(), correct: true }, blankAnswer(), blankAnswer()],
});

export const blankDraft = (): PollDraft => ({
  kind: "poll",
  anonymous: false,
  maxChoices: 1,
  allowCustom: false,
  allowChange: true,
  results: "always",
  closesAt: "",
  questions: [blankQuestion()],
});

// How many answers the first question will have once blank new rows are left out.
export const listedAnswers = (draft: PollDraft) =>
  (draft.questions[0]?.answers ?? []).filter(
    (answer) => answer.id !== undefined || answer.text.trim() !== "",
  ).length;

function closesAtOf(draft: PollDraft): string | null {
  if (!draft.closesAt) return null;
  if (draft.closesAtWas && draft.closesAt === toLocalInput(draft.closesAtWas))
    return draft.closesAtWas;
  return new Date(draft.closesAt).toISOString();
}

// An ISO time as a `datetime-local` value (the browser's own zone), and back.
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function draftFromDefinition(definition: PollDefinitionView): PollDraft {
  const picture = (image: { fileId: number } | null): DraftPicture | null =>
    image ? { fileId: image.fileId, name: `#${image.fileId}` } : null;
  return {
    kind: definition.kind,
    anonymous: definition.anonymous,
    maxChoices: definition.maxChoices,
    allowCustom: definition.allowCustom,
    allowChange: definition.allowChange,
    results: definition.results,
    closesAt: toLocalInput(definition.closesAt),
    ...(definition.closesAt && { closesAtWas: definition.closesAt }),
    loadedAt: definition.updatedAt,

    questions: definition.questions.map((question) => ({
      id: question.id,
      text: question.text,
      explanation: question.explanation,
      picture: picture(question.image),
      answers: question.answers.map((answer) => ({
        id: answer.id,
        text: answer.text,
        correct: answer.correct,
        picture: picture(answer.image),
        custom: answer.custom,
        votes: answer.votes,
      })),
    })),
  };
}

// The draft as the backend takes it. Blank new answers are left out, so a form that starts with
// spare rows is not refused for them. A poll sends no right answers and no explanations.
export function draftToInput(draft: PollDraft): PollInputValue {
  const quiz = draft.kind === "quiz";
  return {
    kind: draft.kind,
    anonymous: draft.anonymous,
    // A vote cannot pick more answers than are left once the blank rows are dropped.
    maxChoices: quiz
      ? 1
      : Math.max(1, Math.min(draft.maxChoices, listedAnswers(draft))),
    allowCustom: quiz ? false : draft.allowCustom,
    allowChange: draft.allowChange,
    results: draft.results,
    closesAt: closesAtOf(draft),
    questions: draft.questions.map((question) => ({
      ...(question.id !== undefined && { id: question.id }),
      text: question.text,
      imageFileId: question.picture?.fileId ?? null,
      explanation: quiz ? question.explanation : "",
      answers: question.answers
        .filter(
          (answer) => answer.id !== undefined || answer.text.trim() !== "",
        )
        .map((answer) => ({
          ...(answer.id !== undefined && { id: answer.id }),
          text: answer.text,
          imageFileId: answer.picture?.fileId ?? null,
          correct: quiz && answer.correct,
        })),
    })),
  };
}

// What a form field carries: the whole draft as one JSON text, read again by the action.
export const draftToJson = (draft: PollDraft) =>
  JSON.stringify(draftToInput(draft));

// What an action reads from that field: the object, or null for no poll or a text that is not
// JSON. The backend validates the rest.
export function pollFromJson(text: string): PollInputValue | null {
  if (text.trim() === "") return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as PollInputValue)
      : null;
  } catch {
    return null;
  }
}

// A share of the whole as a whole percent, 0 when nobody voted.
export const percentOf = (part: number, whole: number) =>
  whole > 0 ? Math.round((part * 100) / whole) : 0;
