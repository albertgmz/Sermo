"use server";

import {
  pollsAddAnswer,
  pollsClose,
  pollsCreate,
  pollsDefinition,
  pollsDelete,
  pollsUpdate,
  pollsVote,
  pollsVoters,
} from "@sermo/core/contracts";
import { refresh } from "next/cache";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";
import {
  type PollDefinitionView,
  type PollView,
  pollFromJson,
} from "@/lib/sermo/polls";

// What the poll screens hear back: the poll as the viewer sees it now, or the backend's refusal.
export type PollAnswer = { poll: PollView } | { error: string };
export type VotersAnswer =
  | {
      items: { id: number; username: string }[];
      nextCursor: string | null;
    }
  | { error: string };

const back = (threadId: number) => `/threads/${threadId}`;

export async function pollVoteAction(
  threadId: number,
  pollId: number,
  questionId: number,
  answerIds: number[],
): Promise<PollAnswer> {
  requireIds(threadId, pollId, questionId, ...answerIds);
  const done = await attempt(back(threadId), () =>
    call(pollsVote, { pollId, questionId, answerIds }),
  );
  return done.ok ? { poll: done.value } : { error: done.error };
}

export async function pollAddAnswerAction(
  threadId: number,
  pollId: number,
  text: string,
): Promise<PollAnswer> {
  requireIds(threadId, pollId);
  const done = await attempt(back(threadId), () =>
    call(pollsAddAnswer, { pollId, text }),
  );
  return done.ok ? { poll: done.value } : { error: done.error };
}

export async function pollCloseAction(
  threadId: number,
  pollId: number,
  closed: boolean,
): Promise<PollAnswer> {
  requireIds(threadId, pollId);
  const done = await attempt(back(threadId), () =>
    call(pollsClose, { pollId, closed }),
  );
  if (!done.ok) return { error: done.error };
  refresh();
  return { poll: done.value };
}

export async function pollDeleteAction(
  threadId: number,
  pollId: number,
  _previous: { error?: string; done?: boolean },
  formData: FormData,
): Promise<{ error?: string; done?: boolean }> {
  requireIds(threadId, pollId);
  const done = await attempt(back(threadId), () =>
    call(pollsDelete, {
      pollId,
      reason: String(formData.get("reason") ?? ""),
    }),
  );
  if (!done.ok) return { error: done.error };
  refresh();
  return { done: true };
}

export async function pollVotersAction(
  threadId: number,
  pollId: number,
  answerId: number,
  cursor: string | null,
): Promise<VotersAnswer> {
  requireIds(threadId, pollId, answerId);
  const done = await attempt(back(threadId), () =>
    call(pollsVoters, {
      pollId,
      answerId,
      limit: 50,
      ...(cursor && { cursor }),
    }),
  );
  if (!done.ok) return { error: done.error };
  return {
    items: done.value.items.map((item) => item.user),
    nextCursor: done.value.nextCursor,
  };
}

export async function pollDefinitionAction(
  threadId: number,
  pollId: number,
): Promise<{ definition: PollDefinitionView } | { error: string }> {
  requireIds(threadId, pollId);
  const done = await attempt(back(threadId), () =>
    call(pollsDefinition, { pollId }),
  );
  return done.ok ? { definition: done.value } : { error: done.error };
}

// Saves the poll of a thread: a new one when `pollId` is null, the edited one otherwise. The
// definition travels as the JSON the form kept in its field; the backend judges every part of it.
export async function pollSaveAction(
  threadId: number,
  pollId: number | null,
  json: string,
): Promise<PollAnswer> {
  requireIds(threadId);
  if (pollId !== null) requireIds(pollId);
  const input = pollFromJson(json);
  if (!input) return { error: "" };
  const done = await attempt(back(threadId), () => {
    if (pollId === null) return call(pollsCreate, { threadId, poll: input });
    const { kind: _kind, anonymous: _anonymous, ...edit } = input;
    return call(pollsUpdate, { pollId, poll: edit });
  });
  if (!done.ok) return { error: done.error };
  refresh();
  return { poll: done.value };
}
