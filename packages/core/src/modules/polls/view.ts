import type * as z from "zod";
import { type Actor, actorUserId } from "../../actor";
import type { Ctx } from "../../context";
import type { Poll } from "../../contracts/polls";
import { markPublic } from "../../operation";
import { permissionsOf } from "../../permissions";
import { iso, isoOrNull } from "../../time";
import { loadAttachments } from "../attachments";
import { isClosed, type PollThread, pollRights, resultsShown } from "./policy";
import { type AnswerRow, type PollRow, pollParts, type QuestionRow } from "./store";

type PollValue = z.infer<typeof Poll>;
type Picture = NonNullable<PollValue["questions"][number]["image"]>;

function pictures(ctx: Ctx, pollIds: number[], rows: { image_file_id: number | null }[]) {
  const wanted = rows.some((row) => row.image_file_id !== null);
  const byFile = new Map<number, Picture>();
  if (!wanted) return byFile;
  for (const [, list] of loadAttachments(ctx, "poll", pollIds))
    for (const picture of list) byFile.set(picture.fileId, picture);
  return byFile;
}

/**
 * The polls of a page as the viewer sees them, in one query per table whatever their number:
 * counts only where the poll's rule shows them to this viewer, a quiz's right answers and
 * explanations only for the questions the viewer has answered, and the viewer's own choices.
 * `threads` holds each poll's thread (callers have already decided the viewer may read it).
 */
export const pollValues = markPublic(
  "Reveals only what the viewer's own votes, the results rule and the thread's read gates allow; callers open the thread first.",
  function pollValues(
    ctx: Ctx,
    actor: Actor,
    polls: PollRow[],
    threads: Map<number, PollThread>,
  ): Map<number, PollValue> {
    const out = new Map<number, PollValue>();
    if (polls.length === 0) return out;
    const userId = actorUserId(actor);
    const ids = polls.map((poll) => poll.id);
    const parts = pollParts(ctx, ids, userId);
    const permissions = permissionsOf(ctx, actor);
    const now = ctx.now();
    const pictureOf = pictures(ctx, ids, [...parts.questions, ...parts.answers]);
    const questionsOf = new Map<number, QuestionRow[]>();
    for (const row of parts.questions) {
      const list = questionsOf.get(row.poll_id) ?? [];
      list.push(row);
      questionsOf.set(row.poll_id, list);
    }
    const answersOf = new Map<number, AnswerRow[]>();
    for (const row of parts.answers) {
      const list = answersOf.get(row.question_id) ?? [];
      list.push(row);
      answersOf.set(row.question_id, list);
    }
    const chosen = new Set(parts.votes.map((vote) => vote.answer_id));
    const answeredQuestions = new Set(parts.votes.map((vote) => vote.question_id));
    const ballots = new Map(parts.ballots.map((ballot) => [ballot.poll_id, ballot]));
    for (const poll of polls) {
      const thread = threads.get(poll.thread_id)!;
      const rights = pollRights(permissions, actor, poll, thread, now);
      const ballot = ballots.get(poll.id);
      const closed = isClosed(poll, now);
      const quiz = poll.kind === "quiz";
      const shown = resultsShown(poll, userId, rights.manage, ballot !== undefined, closed);
      const mayVote = quiz ? ballot?.completed_at == null : !ballot || !!poll.allow_change;
      const addedOwn = parts.answers.some((a) => a.poll_id === poll.id && a.added_by === userId);
      out.set(poll.id, {
        id: poll.id,
        threadId: poll.thread_id,
        kind: poll.kind,
        anonymous: !!poll.anonymous,
        maxChoices: poll.max_choices,
        allowCustom: !!poll.allow_custom,
        allowChange: !!poll.allow_change,
        results: poll.results,
        closesAt: isoOrNull(poll.closes_at),
        closed,
        resultsShown: shown,
        voterCount: shown ? poll.ballot_count : null,
        questions: (questionsOf.get(poll.id) ?? []).map((question) => {
          const answered = answeredQuestions.has(question.id);
          return {
            id: question.id,
            text: question.text,
            image: pictureOf.get(question.image_file_id ?? 0) ?? null,
            // A quiz tells what it knows only after the viewer has answered.
            explanation: quiz && answered ? question.explanation : null,
            answered,
            answers: (answersOf.get(question.id) ?? []).map((answer) => ({
              id: answer.id,
              text: answer.text,
              image: pictureOf.get(answer.image_file_id ?? 0) ?? null,
              votes: shown && !quiz ? answer.vote_count : null,
              chosen: chosen.has(answer.id),
              correct: quiz && answered ? !!answer.is_correct : null,
              custom: answer.added_by !== null,
            })),
          };
        }),
        mine: {
          voted: ballot !== undefined,
          answered: ballot?.answered ?? 0,
          correct: ballot?.score ?? 0,
          completed: ballot?.completed_at != null,
        },
        permissions: {
          canVote: rights.vote && rights.open && userId !== null && mayVote,
          canAddAnswer: rights.addAnswer && !addedOwn,
          canEdit: rights.edit,
          canDelete: rights.delete,
          canClose: rights.close,
          canViewVoters: rights.viewVoters && shown,
        },
        createdAt: iso(poll.created_at),
        updatedAt: iso(poll.updated_at),
      });
    }
    return out;
  },
);
