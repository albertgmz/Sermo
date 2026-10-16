import { insertUser } from "@sermo/core/testing";
import type * as z from "zod";
import type { Poll, PollDefinition } from "../../contracts/polls";
import type { World } from "../feed/fixtures.test";

export type PollValue = z.infer<typeof Poll>;
export type QuestionValue = PollValue["questions"][number];
export type AnswerValue = QuestionValue["answers"][number];
export type DefinitionValue = z.infer<typeof PollDefinition>;
/** The shape polls.update takes, loosely: tests change it in place. */
export interface EditInput {
  maxChoices: number;
  allowCustom: boolean;
  allowChange: boolean;
  results: string;
  closesAt: string | null;
  questions: {
    id?: number;
    text: string;
    explanation?: string;
    answers: { id?: number; text: string; correct?: boolean }[];
  }[];
}

/** One question with three answers: a poll. */
export const colours = (over: object = {}) => ({
  questions: [
    { text: "Best colour?", answers: [{ text: "Red" }, { text: "Blue" }, { text: "Green" }] },
  ],
  ...over,
});

/** A thread of `actor` in the open forum, with a poll written with it. */
export async function withPoll(
  w: World,
  actor: World["alice"],
  poll: object = colours(),
  title = "Poll thread",
): Promise<{ threadId: number; poll: PollValue }> {
  w.ctx.clock.advance(60_000);
  const created = await w.call("threads.create", actor, {
    nodeId: w.open.id,
    title,
    body: "Pick one.",
    poll,
  });
  const got = await w.call("polls.get", actor, { threadId: created.thread.id });
  return { threadId: created.thread.id as number, poll: got.poll as PollValue };
}

export const answerIds = (poll: PollValue, q = 0): number[] =>
  poll.questions[q]!.answers.map((a) => a.id);

/** The stored vote counters of a poll's answers, in order. */
export const counts = (w: World, pollId: number): number[] =>
  w.ctx.sqlite
    .prepare<{ vote_count: number }, [number]>(
      "SELECT vote_count FROM poll_answers WHERE poll_id = ?1 ORDER BY id",
    )
    .all(pollId)
    .map((row) => row.vote_count);

export const pollVoteCount = (w: World, userId: number): number =>
  w.ctx.sqlite
    .prepare<{ n: number }, [number]>("SELECT poll_vote_count AS n FROM users WHERE id = ?1")
    .get(userId)!.n;

/** Gives a poll `count` voters at once, as the triggers would see them (one answer each). */
export function crowd(w: World, poll: PollValue, count: number): number[] {
  const answers = answerIds(poll);
  const question = poll.questions[0]?.id ?? 0;
  const users = Array.from({ length: count }, () => insertUser(w.ctx).id);
  w.ctx.sqlite.transaction(() => {
    const ballot = w.ctx.sqlite.prepare(
      "INSERT INTO poll_ballots (poll_id, user_id, answered, score, created_at, completed_at) VALUES (?1, ?2, 1, 0, 1, 1)",
    );
    const vote = w.ctx.sqlite.prepare(
      "INSERT INTO poll_votes (poll_id, question_id, answer_id, user_id, created_at) VALUES (?1, ?2, ?3, ?4, 1)",
    );
    users.forEach((user, i) => {
      ballot.run(poll.id, user);
      vote.run(poll.id, question, answers[i % answers.length] ?? 0, user);
    });
  })();
  return users;
}
