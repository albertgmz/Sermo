"use server";

import {
  postsCreateAsGuest,
  threadsCreateAsGuest,
} from "@sermo/core/contracts";
import { call, errorMessage } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { parseId, requireIds } from "@/lib/sermo/ids";
import { tokenOf } from "@/lib/turnstile/field";

// What a guest's form shows after sending: the post is taken (`done`, held for approval, so there
// is nothing to open), or the refusal, said under the name when it is the name's.
export type GuestPostState = {
  error?: string;
  nameError?: string;
  done?: boolean;
};

const textOf = (formData: FormData, name: string) =>
  String(formData.get(name) ?? "");

async function refusal(error: unknown): Promise<GuestPostState> {
  const forName =
    error instanceof SermoError
      ? error.issues?.find(
          (issue) => Array.isArray(issue.path) && issue.path[0] === "name",
        )
      : undefined;
  if (forName?.message) return { nameError: forName.message };
  return { error: await errorMessage(error) };
}

export async function guestReplyAction(
  threadId: number,
  _previous: GuestPostState,
  formData: FormData,
): Promise<GuestPostState> {
  requireIds(threadId);
  try {
    await call(postsCreateAsGuest, {
      threadId,
      body: textOf(formData, "body"),
      name: textOf(formData, "name"),
      turnstileToken: tokenOf(formData),
    });
    return { done: true };
  } catch (error) {
    return refusal(error);
  }
}

export async function guestThreadAction(
  nodeId: number,
  _previous: GuestPostState,
  formData: FormData,
): Promise<GuestPostState> {
  requireIds(nodeId);
  const prefixId = textOf(formData, "prefixId");
  if (prefixId) requireIds(parseId(prefixId));
  try {
    await call(threadsCreateAsGuest, {
      nodeId,
      title: textOf(formData, "title"),
      body: textOf(formData, "body"),
      prefixId: prefixId ? (parseId(prefixId) as number) : null,
      name: textOf(formData, "name"),
      turnstileToken: tokenOf(formData),
    });
    return { done: true };
  } catch (error) {
    return refusal(error);
  }
}
