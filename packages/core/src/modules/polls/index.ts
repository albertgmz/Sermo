import * as z from "zod";
import { type Actor, actorUserId, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import * as contracts from "../../contracts/polls";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { currentActor, permissionsOf, requirePermission } from "../../permissions";
import { loadUserSummaries } from "../../shared/users";
import { iso, isoOrNull } from "../../time";
import { loadAttachments } from "../attachments";
import { readGates, requireThread } from "../forums";
import { requireSiteView } from "../members/site-access";
import { appendModeratorLog } from "../moderation";
import { purgePolls } from "../purge/purge";
import { isClosed, mayAddPoll, type PollThread, pollRights, resultsShown } from "./policy";
import { requirePoll } from "./readable";
import {
  castVote,
  insertCustomAnswer,
  insertPoll,
  type PollRow,
  pollOfThread,
  pollParts,
  pollSql,
  publishVoted,
  replacePoll,
  setClosed,
} from "./store";
import { type CleanPoll, cleanAnswerText, cleanPoll } from "./text";
import { pollValues } from "./view";

const CLOSED_FORUM = "The posts of this forum are not open to you.";
const voterCursor = z.tuple([z.number().int()]);

/** The poll as the viewer sees it now (after a write, read again). */
function present(ctx: Ctx, actor: Actor, pollId: number) {
  const { poll, thread } = requirePoll(ctx, actor, pollId);
  return pollValues(ctx, actor, [poll], new Map([[thread.id, thread]])).get(poll.id)!;
}

/** Why the viewer may not vote now, or nothing. The permission first, then the thread, then the poll. */
function requireVoting(ctx: Ctx, actor: Actor, poll: PollRow, thread: PollThread): void {
  requirePermission(ctx, actor, "poll.vote", { nodeId: thread.node_id });
  if (thread.state !== "visible") throw new ForbiddenError("This thread is not open for voting.");
  if (isClosed(poll, ctx.now())) throw new ConflictError("This poll is closed.");
}

/** Whether the definition names a picture the poll does not hold yet (those need the upload permission). */
function needsUpload(ctx: Ctx, pollId: number | null, clean: CleanPoll): boolean {
  const wanted = clean.questions
    .flatMap((question) => [
      question.imageFileId,
      ...question.answers.map((answer) => answer.imageFileId),
    ])
    .filter((id): id is number => id !== null);
  if (wanted.length === 0) return false;
  const held = new Set(
    pollId === null
      ? []
      : [...loadAttachments(ctx, "poll", [pollId]).values()].flat().map((file) => file.fileId),
  );
  return wanted.some((id) => !held.has(id));
}

/** A text a word filter holds for approval has no queue to wait in: it is refused here. */
function requireNotHeld(clean: CleanPoll): void {
  if (clean.moderated)
    throw new ValidationError(
      "The text uses a word the forum holds for approval, and a poll cannot wait for it. Reword it.",
    );
}

const getOp = implement(contracts.pollsGet, (ctx, actor, input) => {
  const { row } = requireThread(ctx, actor, input.threadId);
  requireSiteView(ctx, actor);
  // A thread whose posts are closed to the viewer holds no poll for them.
  if (!readGates(ctx, actor).reads(row.node_id, row.user_id))
    return { poll: null, canCreate: false };
  const poll = pollOfThread(ctx, row.id);
  if (!poll) return { poll: null, canCreate: mayAddPoll(permissionsOf(ctx, actor), actor, row) };
  return {
    poll: pollValues(ctx, actor, [poll], new Map([[row.id, row]])).get(poll.id)!,
    canCreate: false,
  };
});

const createOp = implement(contracts.pollsCreate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  const { row } = requireThread(ctx, actor, input.threadId);
  requireSiteView(ctx, actor);
  if (!readGates(ctx, actor).reads(row.node_id, row.user_id))
    throw new ForbiddenError(CLOSED_FORUM);
  if (!mayAddPoll(permissionsOf(ctx, actor), actor, row)) {
    requirePermission(ctx, actor, "poll.create", { nodeId: row.node_id });
    throw new ForbiddenError("Only the thread's author or staff can add a poll to it.");
  }
  const clean = cleanPoll(ctx, actor, input.poll);
  requireNotHeld(clean);
  if (needsUpload(ctx, null, clean))
    requirePermission(ctx, actor, "forum.uploadAttachments", { nodeId: row.node_id });
  const pollId = writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    const thread = requireThread(ctx, current, input.threadId).row;
    if (!mayAddPoll(permissionsOf(ctx, current), current, thread)) throw new ForbiddenError();
    if (pollOfThread(ctx, thread.id)) throw new ConflictError("This thread already has a poll.");
    if (JSON.stringify(cleanPoll(ctx, current, input.poll)) !== JSON.stringify(clean))
      throw new ConflictError("Moderation rules changed; retry.");
    const id = insertPoll(ctx, user.userId, thread.id, clean);
    if (thread.user_id !== user.userId)
      appendModeratorLog(
        ctx,
        actor,
        "poll.create",
        "thread",
        thread.id,
        "",
        { pollId: id, kind: clean.kind },
        thread.node_id,
      );
    return id;
  });
  return present(ctx, actor, pollId);
});

const updateOp = implement(contracts.pollsUpdate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requireSiteView(ctx, actor);
  const { poll, thread } = requirePoll(ctx, actor, input.pollId);
  const rights = pollRights(permissionsOf(ctx, actor), actor, poll, thread, ctx.now());
  if (!rights.edit) throw new ForbiddenError();
  const edited = { ...input.poll, kind: poll.kind, anonymous: !!poll.anonymous };
  const clean = cleanPoll(ctx, actor, edited, poll.closes_at);
  requireNotHeld(clean);
  if (needsUpload(ctx, poll.id, clean))
    requirePermission(ctx, actor, "forum.uploadAttachments", { nodeId: thread.node_id });
  writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    const fresh = requirePoll(ctx, current, input.pollId);
    const now = pollRights(
      permissionsOf(ctx, current),
      current,
      fresh.poll,
      fresh.thread,
      ctx.now(),
    );
    if (!now.edit) throw new ForbiddenError();
    if (
      JSON.stringify(cleanPoll(ctx, current, edited, fresh.poll.closes_at)) !==
      JSON.stringify(clean)
    )
      throw new ConflictError("Moderation rules changed; retry.");
    replacePoll(ctx, user.userId, fresh.poll, clean, now.manage);
    if (fresh.poll.user_id !== user.userId)
      appendModeratorLog(
        ctx,
        actor,
        "poll.update",
        "thread",
        fresh.thread.id,
        input.reason,
        { pollId: fresh.poll.id },
        fresh.thread.node_id,
      );
  });
  return present(ctx, actor, input.pollId);
});

const voteOp = implement(contracts.pollsVote, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requireSiteView(ctx, actor);
  const { poll, thread } = requirePoll(ctx, actor, input.pollId);
  requireVoting(ctx, actor, poll, thread);
  writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    const fresh = requirePoll(ctx, current, input.pollId);
    requireVoting(ctx, current, fresh.poll, fresh.thread);
    if (castVote(ctx, fresh.poll, user.userId, input.questionId, input.answerIds))
      publishVoted(ctx, poll.id, user.userId);
  });
  return present(ctx, actor, input.pollId);
});

const addAnswerOp = implement(contracts.pollsAddAnswer, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requireSiteView(ctx, actor);
  const { poll, thread } = requirePoll(ctx, actor, input.pollId);
  requireVoting(ctx, actor, poll, thread);
  requirePermission(ctx, actor, "poll.addAnswer", { nodeId: thread.node_id });
  if (poll.kind !== "poll" || !poll.allow_custom)
    throw new ConflictError("This poll takes no custom answers.");
  const answer = cleanAnswerText(ctx, actor, input.text);
  if (answer.moderated)
    throw new ValidationError(
      "The text uses a word the forum holds for approval, and a poll cannot wait for it. Reword it.",
    );
  writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    const fresh = requirePoll(ctx, current, input.pollId);
    requireVoting(ctx, current, fresh.poll, fresh.thread);
    requirePermission(ctx, current, "poll.addAnswer", { nodeId: fresh.thread.node_id });
    if (!fresh.poll.allow_custom) throw new ConflictError("This poll takes no custom answers.");
    if (cleanAnswerText(ctx, current, input.text).text !== answer.text)
      throw new ConflictError("Moderation rules changed; retry.");
    insertCustomAnswer(ctx, fresh.poll, user.userId, answer.text);
  });
  return present(ctx, actor, input.pollId);
});

const closeOp = implement(contracts.pollsClose, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requireSiteView(ctx, actor);
  const { poll, thread } = requirePoll(ctx, actor, input.pollId);
  const rights = pollRights(permissionsOf(ctx, actor), actor, poll, thread, ctx.now());
  if (!rights.close) throw new ForbiddenError();
  writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    const fresh = requirePoll(ctx, current, input.pollId);
    const now = pollRights(
      permissionsOf(ctx, current),
      current,
      fresh.poll,
      fresh.thread,
      ctx.now(),
    );
    if (!now.close) throw new ForbiddenError();
    setClosed(ctx, fresh.poll.id, input.closed);
    if (fresh.poll.user_id !== user.userId)
      appendModeratorLog(
        ctx,
        actor,
        input.closed ? "poll.close" : "poll.reopen",
        "thread",
        fresh.thread.id,
        input.reason,
        { pollId: fresh.poll.id },
        fresh.thread.node_id,
      );
  });
  return present(ctx, actor, input.pollId);
});

const deleteOp = implement(contracts.pollsDelete, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requireSiteView(ctx, actor);
  const { poll, thread } = requirePoll(ctx, actor, input.pollId);
  if (!pollRights(permissionsOf(ctx, actor), actor, poll, thread, ctx.now()).delete)
    throw new ForbiddenError();
  writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    const fresh = requirePoll(ctx, current, input.pollId);
    if (
      !pollRights(permissionsOf(ctx, current), current, fresh.poll, fresh.thread, ctx.now()).delete
    )
      throw new ForbiddenError();
    purgePolls(ctx, [fresh.poll.id]);
    // The log names the poll and how many took part, never who: an anonymous poll stays so.
    if (fresh.poll.user_id !== user.userId)
      appendModeratorLog(
        ctx,
        actor,
        "poll.delete",
        "thread",
        fresh.thread.id,
        input.reason,
        { pollId: fresh.poll.id, kind: fresh.poll.kind, ballots: fresh.poll.ballot_count },
        fresh.thread.node_id,
      );
  });
  return { ok: true as const };
});

const votersOp = implement(contracts.pollsVoters, (ctx, actor, input) => {
  requireSiteView(ctx, actor);
  const { poll, thread } = requirePoll(ctx, actor, input.pollId);
  if (poll.kind !== "poll" || poll.anonymous)
    throw new ForbiddenError("The voters of this poll are not public.");
  requirePermission(ctx, actor, "poll.viewVoters", { nodeId: thread.node_id });
  const permissions = permissionsOf(ctx, actor);
  const rights = pollRights(permissions, actor, poll, thread, ctx.now());
  const voted = prepared(ctx, "polls.hasBallot", () =>
    ctx.sqlite.prepare<{ found: number }, [number, number]>(
      "SELECT 1 AS found FROM poll_ballots WHERE poll_id = ?1 AND user_id = ?2",
    ),
  ).get(poll.id, actorUserId(actor) ?? -1);
  if (!resultsShown(poll, actorUserId(actor), rights.manage, !!voted, isClosed(poll, ctx.now())))
    throw new ForbiddenError("The results are not shown yet.");
  const owned = prepared(ctx, "polls.answerOfPoll", () =>
    ctx.sqlite.prepare<{ id: number }, [number, number]>(
      "SELECT id FROM poll_answers WHERE id = ?1 AND poll_id = ?2",
    ),
  ).get(input.answerId, poll.id);
  if (!owned) throw new NotFoundError();
  const after = input.cursor ? decodeCursor(input.cursor, voterCursor)[0] : 0;
  const rows = prepared(ctx, "polls.voters", () =>
    ctx.sqlite.prepare<{ user_id: number; created_at: number }, [number, number, number]>(
      pollSql.voters,
    ),
  ).all(input.answerId, after, input.limit + 1);
  const page = rows.slice(0, input.limit);
  const names = loadUserSummaries(
    ctx,
    page.map((row) => row.user_id),
  );
  return {
    items: page.map((row) => ({ user: names(row.user_id), votedAt: iso(row.created_at) })),
    nextCursor: rows.length > input.limit ? encodeCursor([page.at(-1)!.user_id]) : null,
  };
});

const definitionOp = implement(contracts.pollsDefinition, (ctx, actor, input) => {
  requireSiteView(ctx, actor);
  const { poll, thread } = requirePoll(ctx, actor, input.pollId);
  if (!pollRights(permissionsOf(ctx, actor), actor, poll, thread, ctx.now()).edit)
    throw new ForbiddenError();
  const parts = pollParts(ctx, [poll.id], null);
  const files = new Map(
    [...loadAttachments(ctx, "poll", [poll.id]).values()].flat().map((file) => [file.fileId, file]),
  );
  return {
    id: poll.id,
    threadId: poll.thread_id,
    kind: poll.kind,
    anonymous: !!poll.anonymous,
    maxChoices: poll.max_choices,
    allowCustom: !!poll.allow_custom,
    allowChange: !!poll.allow_change,
    results: poll.results,
    closesAt: isoOrNull(poll.closes_at),
    ballotCount: poll.ballot_count,
    questions: parts.questions.map((question) => ({
      id: question.id,
      text: question.text,
      image: files.get(question.image_file_id ?? 0) ?? null,
      explanation: question.explanation,
      answers: parts.answers
        .filter((answer) => answer.question_id === question.id)
        .map((answer) => ({
          id: answer.id,
          text: answer.text,
          image: files.get(answer.image_file_id ?? 0) ?? null,
          correct: !!answer.is_correct,
          custom: answer.added_by !== null,
          votes: answer.vote_count,
        })),
    })),
  };
});

export const operations = [
  getOp,
  createOp,
  updateOp,
  voteOp,
  addAnswerOp,
  closeOp,
  deleteOp,
  votersOp,
  definitionOp,
];
