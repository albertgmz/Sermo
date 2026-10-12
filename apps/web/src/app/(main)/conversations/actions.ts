"use server";

import {
  conversationsCreate,
  conversationsLeave,
  conversationsMarkRead,
  conversationsReply,
  usersSearch,
} from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { attempt } from "@/lib/sermo/outcome";

export type ReplyState = { error?: string };

export async function replyAction(
  conversationId: number,
  _previous: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  const body = String(formData.get("body") ?? "");
  const sent = await attempt(`/conversations/${conversationId}`, () =>
    call(conversationsReply, { conversationId, body }),
  );
  if (!sent.ok) return { error: sent.error };
  // The list, the header and the unread counts are read again.
  revalidatePath("/", "layout");
  redirect(`/conversations/${conversationId}`);
}

// Called by the page itself once the newest message is shown, so a refusal (a dead session, a
// conversation the member left) is nothing the visitor needs to hear about.
export async function markRead(conversationId: number) {
  try {
    await call(conversationsMarkRead, { conversationId });
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    return;
  }
  revalidatePath("/", "layout");
}

export async function leaveAction(conversationId: number) {
  const left = await attempt(`/conversations/${conversationId}`, () =>
    call(conversationsLeave, { conversationId }),
  );
  if (!left.ok) redirect(`/conversations/${conversationId}`);
  revalidatePath("/", "layout");
  redirect("/conversations");
}

export type StartState = {
  error?: string;
  title?: string;
};

export async function startConversation(
  _previous: StartState,
  formData: FormData,
): Promise<StartState> {
  const title = String(formData.get("title") ?? "");
  const body = String(formData.get("body") ?? "");
  const recipientIds = formData.getAll("recipientIds").map(Number);
  const created = await attempt("/conversations/new", () =>
    call(conversationsCreate, { title, recipientIds, body }),
  );
  if (!created.ok) return { error: created.error, title };
  revalidatePath("/", "layout");
  redirect(`/conversations/${created.value.conversation.id}`);
}

// The members whose name starts with what the visitor has typed, for the recipient picker.
export async function findRecipients(prefix: string) {
  try {
    return (await call(usersSearch, { prefix, limit: 25 })).items;
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    return [];
  }
}
