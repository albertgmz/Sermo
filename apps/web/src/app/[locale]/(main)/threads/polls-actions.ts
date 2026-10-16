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
import { getTranslations } from "next-intl/server";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";
import {
  definitionForClient,
  type PollDefinitionView,
  type PollView,
  pollForClient,
  pollFromJson,
} from "@/lib/sermo/polls";

// What the poll screens hear back: the poll as the viewer sees it now, or the backend's refusal.
export type PollAnswer =
  | { poll: PollView }
  | { error: string; conflict?: true };
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
  return done.ok ? { poll: pollForClient(done.value) } : { error: done.error };
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
  return done.ok ? { poll: pollForClient(done.value) } : { error: done.error };
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
  return { poll: pollForClient(done.value) };
}

export async function pollDeleteAction(
  threadId: number,
  pollId: number,
  _previous: { error?: string; done?: boolean },
  formData: FormData,
): Promise<{ error?: string; done?: boolean }> {
  requireIds(threadId, pollId);
  const reason = String(formData.get("reason") ?? "");
  // A poll with very many voters is taken out of sight at once and a background job removes the
  // voters: one call, whatever the size.
  const done = await attempt(back(threadId), () =>
    call(pollsDelete, { pollId, reason }),
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
  return done.ok
    ? { definition: definitionForClient(done.value) }
    : { error: done.error };
}

// Saves the poll of a thread: a new one when `pollId` is null, the edited one otherwise. The
// definition travels as the JSON the form kept in its field; the backend judges every part of it.
export async function pollSaveAction(
  threadId: number,
  pollId: number | null,
  json: string,
  loadedAt?: string,
): Promise<PollAnswer> {
  requireIds(threadId);
  if (pollId !== null) requireIds(pollId);
  const input = pollFromJson(json);
  if (!input)
    return { error: (await getTranslations("forum.poll"))("invalid") };
  let conflict = false;
  const done = await attempt(back(threadId), async () => {
    try {
      if (pollId === null)
        return await call(pollsCreate, { threadId, poll: input });
      const { kind: _kind, anonymous: _anonymous, ...edit } = input;
      return await call(pollsUpdate, {
        pollId,
        poll: edit,
        ...(loadedAt ? { loadedAt } : {}),
      });
    } catch (error) {
      // Only the refusal that names the version is the stale editor; other conflicts say their own.
      if (
        error instanceof SermoError &&
        error.code === "conflict" &&
        error.issues?.some(
          (issue) => Array.isArray(issue.path) && issue.path[0] === "loadedAt",
        )
      )
        conflict = true;
      throw error;
    }
  });
  if (!done.ok)
    return conflict
      ? { error: done.error, conflict: true as const }
      : { error: done.error };
  refresh();
  return { poll: pollForClient(done.value) };
}
