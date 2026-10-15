import type { SQLQueryBindings } from "bun:sqlite";
import { type Ctx, prepared } from "../../context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { MAX_POLL_ANSWERS } from "../../limits";
import { setAttachments } from "../attachments";
import type { CleanAnswer, CleanPoll, CleanQuestion } from "./text";
import { searchTextOf } from "./text";

/**
 * The rows behind polls and quizzes. Everything here runs inside the caller's write transaction
 * when it writes; permissions are decided by the callers. `poll_answers.vote_count`,
 * `polls.ballot_count` and `users.poll_vote_count` are kept by triggers on `poll_votes` and
 * `poll_ballots`, so no code path can forget them and no write reads a count to add to it.
 */

export interface PollRow {
  id: number;
  thread_id: number;
  user_id: number;
  kind: "poll" | "quiz";
  anonymous: number;
  max_choices: number;
  allow_custom: number;
  allow_change: number;
  results: "always" | "after_vote" | "after_close";
  closes_at: number | null;
  closed_at: number | null;
  ballot_count: number;
  created_at: number;
  updated_at: number;
}
export interface QuestionRow {
  id: number;
  poll_id: number;
  position: number;
  text: string;
  explanation: string;
  image_file_id: number | null;
}
export interface AnswerRow {
  id: number;
  poll_id: number;
  question_id: number;
  position: number;
  text: string;
  image_file_id: number | null;
  is_correct: number;
  vote_count: number;
  added_by: number | null;
}
export interface VoteRow {
  poll_id: number;
  question_id: number;
  answer_id: number;
}
export interface BallotRow {
  poll_id: number;
  answered: number;
  score: number;
  completed_at: number | null;
}

const pollColumns =
  "id, thread_id, user_id, kind, anonymous, max_choices, allow_custom, allow_change, results, closes_at, closed_at, ballot_count, created_at, updated_at";
const questionColumns = "id, poll_id, position, text, explanation, image_file_id";
const answerColumns =
  "id, poll_id, question_id, position, text, image_file_id, is_correct, vote_count, added_by";
const inList = "IN (SELECT value FROM json_each(?1))";

/** SQL of the reads, shared with the query-plan tests. */
export const pollSql = {
  byId: `SELECT ${pollColumns} FROM polls WHERE id = ?1`,
  byThread: `SELECT ${pollColumns} FROM polls WHERE thread_id = ?1`,
  questions: `SELECT ${questionColumns} FROM poll_questions WHERE poll_id ${inList} ORDER BY poll_id, position, id`,
  answers: `SELECT ${answerColumns} FROM poll_answers WHERE poll_id ${inList} ORDER BY poll_id, question_id, position, id`,
  myVotes: `SELECT poll_id, question_id, answer_id FROM poll_votes WHERE user_id = ?2 AND poll_id ${inList}`,
  myBallots: `SELECT poll_id, answered, score, completed_at FROM poll_ballots WHERE user_id = ?2 AND poll_id ${inList}`,
  voters:
    "SELECT user_id, created_at FROM poll_votes WHERE answer_id = ?1 AND user_id > ?2 ORDER BY user_id LIMIT ?3",
  votesOfMember: "SELECT answer_id FROM poll_votes WHERE poll_id = ?1 AND user_id = ?2",
};

type Params = SQLQueryBindings[];
function statement<Row>(ctx: Ctx, key: string, sql: string) {
  return prepared(ctx, `polls.${key}`, () => ctx.sqlite.prepare<Row, Params>(sql));
}

export const pollById = (ctx: Ctx, id: number): PollRow | null =>
  statement<PollRow>(ctx, "byId", pollSql.byId).get(id);
export const pollOfThread = (ctx: Ctx, threadId: number): PollRow | null =>
  statement<PollRow>(ctx, "byThread", pollSql.byThread).get(threadId);

/** Rows of a list of polls, in one query each. */
export function pollParts(ctx: Ctx, pollIds: number[], userId: number | null) {
  const json = JSON.stringify(pollIds);
  return {
    questions: statement<QuestionRow>(ctx, "questions", pollSql.questions).all(json),
    answers: statement<AnswerRow>(ctx, "answers", pollSql.answers).all(json),
    votes:
      userId === null ? [] : statement<VoteRow>(ctx, "myVotes", pollSql.myVotes).all(json, userId),
    ballots:
      userId === null
        ? []
        : statement<BallotRow>(ctx, "myBallots", pollSql.myBallots).all(json, userId),
  };
}

function invalid(message: string, path: (string | number)[]): never {
  throw new ValidationError(message, [{ path, message }]);
}

/** The picture files a definition lists, in order: the list the poll's attachments are set to. */
function pictureIds(questions: readonly CleanQuestion[]): number[] {
  return questions.flatMap((question) => [
    ...(question.imageFileId === null ? [] : [question.imageFileId]),
    ...question.answers.flatMap((answer) =>
      answer.imageFileId === null ? [] : [answer.imageFileId],
    ),
  ]);
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Pictures must be images. A picture the poll already holds passes again. */
function requirePictures(ctx: Ctx, ids: number[]): void {
  if (ids.length === 0) return;
  const rows = statement<{ id: number; content_type: string }>(
    ctx,
    "fileTypes",
    "SELECT id, content_type FROM files WHERE id IN (SELECT value FROM json_each(?1))",
  ).all(JSON.stringify(ids));
  if (rows.length !== ids.length) throw new NotFoundError();
  if (rows.some((row) => !IMAGE_TYPES.includes(row.content_type)))
    throw new ValidationError("A picture must be a JPEG, PNG, WebP or GIF image.");
}

function insertQuestion(ctx: Ctx, pollId: number, position: number, q: CleanQuestion): number {
  return statement<{ id: number }>(
    ctx,
    "insertQuestion",
    "INSERT INTO poll_questions (poll_id, position, text, explanation, image_file_id) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id",
  ).get(pollId, position, q.text, q.explanation, q.imageFileId)!.id;
}

function insertAnswer(
  ctx: Ctx,
  pollId: number,
  questionId: number,
  position: number,
  a: CleanAnswer,
  addedBy: number | null,
): number {
  return statement<{ id: number }>(
    ctx,
    "insertAnswer",
    "INSERT INTO poll_answers (poll_id, question_id, position, text, image_file_id, is_correct, added_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id",
  ).get(pollId, questionId, position, a.text, a.imageFileId, Number(a.correct), addedBy, ctx.now())!
    .id;
}

/**
 * Writes a new poll or quiz of a thread whose opening post exists (the search trigger reads it).
 * `actorId` is the member who made it and claims the pictures. Returns the poll's id.
 */
export function insertPoll(ctx: Ctx, actorId: number, threadId: number, clean: CleanPoll): number {
  requirePictures(ctx, pictureIds(clean.questions));
  const now = ctx.now();
  const id = statement<{ id: number }>(
    ctx,
    "insert",
    "INSERT INTO polls (thread_id, user_id, kind, anonymous, max_choices, allow_custom, allow_change, results, closes_at, search_text, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11) RETURNING id",
  ).get(
    threadId,
    actorId,
    clean.kind,
    Number(clean.anonymous),
    clean.maxChoices,
    Number(clean.allowCustom),
    Number(clean.allowChange),
    clean.results,
    clean.closesAt,
    searchTextOf(clean.questions),
    now,
  )!.id;
  clean.questions.forEach((question, qi) => {
    const questionId = insertQuestion(ctx, id, qi, question);
    question.answers.forEach((answer, ai) => {
      insertAnswer(ctx, id, questionId, ai, answer, null);
    });
  });
  setAttachments(ctx, actorId, "poll", id, pictureIds(clean.questions));
  return id;
}

/**
 * Replaces the definition of a poll with `clean`: kept ids keep their votes, the rest is added or
 * removed (with its votes, and the ballots left with none). A quiz that members have taken keeps
 * its questions, answers and right answers. Only staff who manage polls remove an answer that has
 * votes. `actorId` claims new pictures.
 */
export function replacePoll(
  ctx: Ctx,
  actorId: number,
  poll: PollRow,
  clean: CleanPoll,
  manage: boolean,
): void {
  const { questions, answers } = pollParts(ctx, [poll.id], null);
  const questionById = new Map(questions.map((row) => [row.id, row]));
  const answerById = new Map(answers.map((row) => [row.id, row]));
  const quiz = poll.kind === "quiz";
  if (!quiz) {
    // A poll is one question: its row stays whatever id the edit names.
    const only = questions[0]!;
    if (clean.questions[0]!.id !== null && clean.questions[0]!.id !== only.id)
      invalid("Unknown question.", ["questions", 0, "id"]);
    clean.questions[0]!.id = only.id;
  }
  const keptQuestions = new Set<number>();
  const keptAnswers = new Set<number>();
  clean.questions.forEach((question, qi) => {
    if (question.id !== null) {
      if (!questionById.has(question.id)) invalid("Unknown question.", ["questions", qi, "id"]);
      keptQuestions.add(question.id);
    }
    question.answers.forEach((answer, ai) => {
      if (answer.id === null) return;
      const row = answerById.get(answer.id);
      if (!row || row.question_id !== question.id)
        invalid("Unknown answer.", ["questions", qi, "answers", ai, "id"]);
      keptAnswers.add(answer.id);
    });
  });
  const removedAnswers = answers.filter((row) => !keptAnswers.has(row.id));
  const removedQuestions = questions.filter((row) => !keptQuestions.has(row.id));
  const added =
    clean.questions.some((question) => question.id === null) ||
    clean.questions.some((question) => question.answers.some((answer) => answer.id === null));
  if (quiz && poll.ballot_count > 0) {
    const flipped = clean.questions.some((question) =>
      question.answers.some(
        (answer) =>
          answer.id !== null && !!answerById.get(answer.id)!.is_correct !== answer.correct,
      ),
    );
    if (added || removedAnswers.length > 0 || removedQuestions.length > 0 || flipped)
      throw new ConflictError(
        "Members have already taken this quiz: its questions, answers and right answers can no longer change.",
      );
  }
  if (!manage && removedAnswers.some((row) => row.vote_count > 0))
    throw new ForbiddenError("Only staff can remove an answer that has votes.");
  requirePictures(ctx, pictureIds(clean.questions));
  const now = ctx.now();
  statement(
    ctx,
    "updateSettings",
    "UPDATE polls SET max_choices = ?2, allow_custom = ?3, allow_change = ?4, results = ?5, closes_at = ?6, search_text = ?7, updated_at = ?8 WHERE id = ?1",
  ).run(
    poll.id,
    clean.maxChoices,
    Number(clean.allowCustom),
    Number(clean.allowChange),
    clean.results,
    clean.closesAt,
    searchTextOf(clean.questions),
    now,
  );
  if (removedAnswers.length > 0 || removedQuestions.length > 0)
    dropAnswers(ctx, poll.id, [
      ...removedAnswers.map((row) => row.id),
      ...answers
        .filter((row) => removedQuestions.some((q) => q.id === row.question_id))
        .map((row) => row.id),
    ]);
  for (const row of removedQuestions)
    statement(ctx, "deleteQuestion", "DELETE FROM poll_questions WHERE id = ?1").run(row.id);
  clean.questions.forEach((question, qi) => {
    let questionId = question.id;
    if (questionId === null) questionId = insertQuestion(ctx, poll.id, qi, question);
    else
      statement(
        ctx,
        "updateQuestion",
        "UPDATE poll_questions SET position = ?2, text = ?3, explanation = ?4, image_file_id = ?5 WHERE id = ?1",
      ).run(questionId, qi, question.text, question.explanation, question.imageFileId);
    question.answers.forEach((answer, ai) => {
      if (answer.id === null) insertAnswer(ctx, poll.id, questionId, ai, answer, null);
      else
        statement(
          ctx,
          "updateAnswer",
          "UPDATE poll_answers SET position = ?2, text = ?3, image_file_id = ?4, is_correct = ?5 WHERE id = ?1",
        ).run(answer.id, ai, answer.text, answer.imageFileId, Number(answer.correct));
    });
  });
  setAttachments(ctx, actorId, "poll", poll.id, pictureIds(clean.questions));
}

/** Removes answers with their votes, and the ballots of members left with no vote in the poll. */
function dropAnswers(ctx: Ctx, pollId: number, answerIds: number[]): void {
  if (answerIds.length === 0) return;
  const json = JSON.stringify(answerIds);
  statement(
    ctx,
    "deleteVotes",
    "DELETE FROM poll_votes WHERE answer_id IN (SELECT value FROM json_each(?1))",
  ).run(json);
  statement(
    ctx,
    "deleteAnswers",
    "DELETE FROM poll_answers WHERE id IN (SELECT value FROM json_each(?1))",
  ).run(json);
  statement(
    ctx,
    "deleteEmptyBallots",
    "DELETE FROM poll_ballots WHERE poll_id = ?1 AND NOT EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = ?1 AND v.user_id = poll_ballots.user_id)",
  ).run(pollId);
}

/** Closes a poll by hand, or reopens it (a close date already past is cleared). */
export function setClosed(ctx: Ctx, pollId: number, closed: boolean): void {
  const now = ctx.now();
  if (closed)
    statement(
      ctx,
      "close",
      "UPDATE polls SET closed_at = coalesce(closed_at, ?2), updated_at = ?2 WHERE id = ?1",
    ).run(pollId, now);
  else
    statement(
      ctx,
      "reopen",
      "UPDATE polls SET closed_at = NULL, closes_at = CASE WHEN closes_at <= ?2 THEN NULL ELSE closes_at END, updated_at = ?2 WHERE id = ?1",
    ).run(pollId, now);
}

/** A voter's own answer: one per member, never a duplicate of a text the poll already offers. */
export function insertCustomAnswer(ctx: Ctx, poll: PollRow, userId: number, text: string): number {
  const { questions, answers } = pollParts(ctx, [poll.id], null);
  const question = questions[0]!;
  if (answers.some((row) => row.added_by === userId))
    throw new ConflictError("You have already added an answer to this poll.");
  if (answers.some((row) => row.text.toLowerCase() === text.toLowerCase()))
    throw new ConflictError("The poll already has that answer: pick it instead.");
  if (answers.length >= MAX_POLL_ANSWERS)
    throw new ConflictError(`A poll has at most ${MAX_POLL_ANSWERS} answers.`);
  return insertAnswer(
    ctx,
    poll.id,
    question.id,
    answers.length,
    { id: null, text, imageFileId: null, correct: false },
    userId,
  );
}

/**
 * Records a member's vote in a poll, or their answer to one question of a quiz, and says whether
 * it made the member a voter (first vote). The member's choices are replaced as a whole, so the
 * triggers see each insert and delete. A quiz answer is final and adds to the member's score.
 */
export function castVote(
  ctx: Ctx,
  poll: PollRow,
  userId: number,
  questionId: number,
  answerIds: number[],
): boolean {
  const answers = statement<{ id: number; is_correct: number }>(
    ctx,
    "questionAnswers",
    "SELECT id, is_correct FROM poll_answers WHERE poll_id = ?1 AND question_id = ?2",
  ).all(poll.id, questionId);
  if (answers.length === 0) invalid("Unknown question.", ["questionId"]);
  if (new Set(answerIds).size !== answerIds.length)
    invalid("An answer is listed twice.", ["answerIds"]);
  const byId = new Map(answers.map((row) => [row.id, row]));
  if (answerIds.some((id) => !byId.has(id))) invalid("Unknown answer.", ["answerIds"]);
  const now = ctx.now();
  const ballot = statement<{ answered: number }>(
    ctx,
    "ballot",
    "SELECT answered FROM poll_ballots WHERE poll_id = ?1 AND user_id = ?2",
  ).get(poll.id, userId);
  const insertVote = statement(
    ctx,
    "insertVote",
    "INSERT INTO poll_votes (poll_id, question_id, answer_id, user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  );
  if (poll.kind === "quiz") {
    if (answerIds.length !== 1) invalid("A quiz question takes one answer.", ["answerIds"]);
    const done = statement(
      ctx,
      "quizAnswered",
      "SELECT 1 AS found FROM poll_votes WHERE poll_id = ?1 AND user_id = ?2 AND question_id = ?3 LIMIT 1",
    ).get(poll.id, userId, questionId);
    if (done) throw new ConflictError("You have already answered this question.");
    insertVote.run(poll.id, questionId, answerIds[0]!, userId, now);
    const right = byId.get(answerIds[0]!)!.is_correct;
    statement(
      ctx,
      "quizBallot",
      "INSERT INTO poll_ballots (poll_id, user_id, answered, score, created_at, completed_at) VALUES (?1, ?2, 1, ?3, ?4, CASE WHEN (SELECT count(*) FROM poll_questions WHERE poll_id = ?1) <= 1 THEN ?4 END) " +
        "ON CONFLICT (poll_id, user_id) DO UPDATE SET answered = answered + 1, score = score + ?3, completed_at = CASE WHEN answered + 1 >= (SELECT count(*) FROM poll_questions WHERE poll_id = ?1) THEN ?4 ELSE completed_at END",
    ).run(poll.id, userId, right, now);
    return !ballot;
  }
  if (answerIds.length > poll.max_choices)
    invalid(`Pick at most ${poll.max_choices}.`, ["answerIds"]);
  const mine = statement<{ answer_id: number }>(ctx, "mine", pollSql.votesOfMember)
    .all(poll.id, userId)
    .map((row) => row.answer_id);
  if (mine.length > 0) {
    if (!poll.allow_change) throw new ConflictError("You have already voted in this poll.");
    if (mine.length === answerIds.length && answerIds.every((id) => mine.includes(id)))
      return false;
    statement(ctx, "clearVotes", "DELETE FROM poll_votes WHERE poll_id = ?1 AND user_id = ?2").run(
      poll.id,
      userId,
    );
  }
  for (const id of answerIds) insertVote.run(poll.id, questionId, id, userId, now);
  statement(
    ctx,
    "pollBallot",
    "INSERT INTO poll_ballots (poll_id, user_id, answered, score, created_at, completed_at) VALUES (?1, ?2, 1, 0, ?3, ?3) ON CONFLICT (poll_id, user_id) DO NOTHING",
  ).run(poll.id, userId, now);
  return !ballot;
}

/** A member became a voter: the criteria that count participation look at them again. */
export function publishVoted(ctx: Ctx, pollId: number, userId: number): void {
  publishEvent(ctx, {
    type: "poll.voted",
    targetType: "poll",
    targetId: pollId,
    payload: { userId },
  });
}

/**
 * A merge moves the poll of the merged thread to the target when the target has none. Otherwise
 * it stays on the merged-away thread, which nothing reads any more, until that thread is
 * deleted for good.
 */
export function movePoll(ctx: Ctx, sourceThreadId: number, targetThreadId: number): void {
  statement(
    ctx,
    "move",
    "UPDATE polls SET thread_id = ?2 WHERE thread_id = ?1 AND NOT EXISTS (SELECT 1 FROM polls WHERE thread_id = ?2)",
  ).run(sourceThreadId, targetThreadId);
}
