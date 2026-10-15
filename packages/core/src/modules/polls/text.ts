import type * as z from "zod";
import type { Actor } from "../../actor";
import { bbCodeText } from "../../bbcode/mask";
import type { Ctx } from "../../context";
import type { PollInput } from "../../contracts/polls";
import { ValidationError } from "../../errors";
import {
  MAX_POLL_ANSWERS,
  MAX_QUIZ_ANSWERS,
  POLL_ANSWER_LENGTH,
  POLL_EXPLANATION_LENGTH,
  POLL_QUESTION_LENGTH,
} from "../../limits";
import { can } from "../../permissions";
import { applyWordFilters } from "../moderation";

/** The longest question text the search index takes from a poll or quiz. */
const SEARCH_TEXT_LENGTH = 1000;

export interface CleanAnswer {
  id: number | null;
  text: string;
  imageFileId: number | null;
  correct: boolean;
}
export interface CleanQuestion {
  id: number | null;
  text: string;
  explanation: string;
  imageFileId: number | null;
  answers: CleanAnswer[];
}
/** A poll definition after its texts are read and every rule that needs no row is checked. */
export interface CleanPoll {
  kind: "poll" | "quiz";
  anonymous: boolean;
  maxChoices: number;
  allowCustom: boolean;
  allowChange: boolean;
  results: "always" | "after_vote" | "after_close";
  closesAt: number | null;
  questions: CleanQuestion[];
  /** A word filter holds some of its text for approval. */
  moderated: boolean;
}

function invalid(message: string, path: (string | number)[]): never {
  throw new ValidationError(message, [{ path, message }]);
}

/**
 * One text of a poll: its BB code read for the words only (tags, pictures, links and media leave
 * nothing), on one line, under the word filter (a replace filter rewrites it, a filter that holds
 * for approval is reported in `held`), within its length. Not read twice: the result is stored.
 */
function line(
  ctx: Ctx,
  actor: Actor,
  raw: string,
  max: number,
  path: (string | number)[],
  held: { value: boolean },
  options: { optional?: boolean } = {},
): string {
  let text = bbCodeText(raw).replace(/\s+/g, " ").trim();
  if (text && !can(ctx, actor, "antispam.bypassWordFilter")) {
    const filtered = applyWordFilters(ctx, text);
    if (filtered.moderated) held.value = true;
    text = filtered.source.replace(/\s+/g, " ").trim();
  }
  if (!text && !options.optional) invalid("This text is empty once its BB code is read.", path);
  if (text.length > max) invalid(`At most ${max} characters.`, path);
  return text;
}

/** The text of one custom answer, as a creator's would be read. */
export function cleanAnswerText(
  ctx: Ctx,
  actor: Actor,
  raw: string,
): { text: string; moderated: boolean } {
  const held = { value: false };
  const text = line(ctx, actor, raw, POLL_ANSWER_LENGTH, ["text"], held);
  return { text, moderated: held.value };
}

/**
 * Reads and checks a poll or quiz the creator wrote, whole: kinds and sizes, one correct answer
 * per quiz question, no repeated answer text, no repeated id or picture. The rules that need
 * the stored poll (which ids exist, what may be removed) are the writer's.
 */
export function cleanPoll(
  ctx: Ctx,
  actor: Actor,
  input: z.output<typeof PollInput>,
  /** The close date the poll already has: it may stay even once it is past. */
  previousClosesAt: number | null = null,
): CleanPoll {
  const quiz = input.kind === "quiz";
  if (!quiz && input.questions.length !== 1)
    invalid("A poll has exactly one question; use a quiz for a series.", ["questions"]);
  if (quiz && input.allowCustom) invalid("A quiz takes no custom answers.", ["allowCustom"]);
  const held = { value: false };
  const ids = {
    questions: new Set<number>(),
    answers: new Set<number>(),
    files: new Set<number>(),
  };
  const questions = input.questions.map((question, qi): CleanQuestion => {
    const path = ["questions", qi];
    if (question.id !== undefined) {
      if (ids.questions.has(question.id)) invalid("A question is listed twice.", [...path, "id"]);
      ids.questions.add(question.id);
    }
    const limit = quiz ? MAX_QUIZ_ANSWERS : MAX_POLL_ANSWERS;
    if (question.answers.length > limit) invalid(`At most ${limit} answers.`, [...path, "answers"]);
    const texts = new Set<string>();
    let right = 0;
    const answers = question.answers.map((answer, ai): CleanAnswer => {
      const apath = [...path, "answers", ai];
      if (answer.id !== undefined) {
        if (ids.answers.has(answer.id)) invalid("An answer is listed twice.", [...apath, "id"]);
        ids.answers.add(answer.id);
      }
      if (answer.correct) right++;
      const text = line(ctx, actor, answer.text, POLL_ANSWER_LENGTH, [...apath, "text"], held);
      if (texts.has(text.toLowerCase())) invalid("Two answers read the same.", [...apath, "text"]);
      texts.add(text.toLowerCase());
      return {
        id: answer.id ?? null,
        text,
        imageFileId: answer.imageFileId,
        correct: answer.correct,
      };
    });
    if (!quiz && right > 0) invalid("Only a quiz has right answers.", [...path, "answers"]);
    if (quiz && right !== 1) invalid("Mark exactly one right answer.", [...path, "answers"]);
    if (!quiz && question.explanation)
      invalid("Only a quiz question has an explanation.", [...path, "explanation"]);
    for (const file of [question.imageFileId, ...question.answers.map((a) => a.imageFileId)]) {
      if (file === null) continue;
      if (ids.files.has(file)) invalid("A picture is used twice.", path);
      ids.files.add(file);
    }
    return {
      id: question.id ?? null,
      text: line(ctx, actor, question.text, POLL_QUESTION_LENGTH, [...path, "text"], held),
      explanation: line(
        ctx,
        actor,
        question.explanation,
        POLL_EXPLANATION_LENGTH,
        [...path, "explanation"],
        held,
        { optional: true },
      ),
      imageFileId: question.imageFileId,
      answers,
    };
  });
  const maxChoices = quiz ? 1 : input.maxChoices;
  if (maxChoices > questions[0]!.answers.length && !quiz)
    invalid("A vote cannot pick more answers than there are.", ["maxChoices"]);
  let closesAt: number | null = null;
  if (input.closesAt !== null) {
    closesAt = Date.parse(input.closesAt);
    if (!Number.isFinite(closesAt)) invalid("Not a date.", ["closesAt"]);
    if (closesAt <= ctx.now() && closesAt !== previousClosesAt)
      invalid("The close date must be in the future.", ["closesAt"]);
  }
  return {
    kind: input.kind,
    anonymous: input.anonymous,
    maxChoices,
    allowCustom: input.allowCustom,
    allowChange: quiz ? false : input.allowChange,
    results: input.results,
    closesAt,
    questions,
    moderated: held.value,
  };
}

/** What the search index reads of a poll with its thread: the question texts. */
export function searchTextOf(questions: readonly { text: string }[]): string {
  return questions
    .map((question) => question.text)
    .join("\n")
    .slice(0, SEARCH_TEXT_LENGTH);
}
