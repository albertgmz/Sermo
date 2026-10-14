"use server";

import {
  conversationsAddParticipants,
  conversationsCreate,
  conversationsLeave,
  conversationsMarkRead,
  conversationsRename,
  conversationsReply,
  conversationsSetLocked,
  usersSearch,
} from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { formIds, requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";

export type ReplyState = { error?: string };

export async function replyAction(
  conversationId: number,
  _previous: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  requireIds(conversationId);
  const body = String(formData.get("body") ?? "");
  const attachmentIds = formIds(formData, "attachmentIds");
  const sent = await attempt(`/conversations/${conversationId}`, () =>
    call(conversationsReply, { conversationId, body, attachmentIds }),
  );
  if (!sent.ok) return { error: sent.error };
  // The page the member lands on is rendered afresh, with their message on it.
  redirect(`/conversations/${conversationId}`);
}

// Called by the page itself once the newest message is shown, so a refusal (a dead session, a
// conversation the member left) is nothing the visitor needs to hear about: it comes back as false,
// the page stays as it is and the unread counts are right on the next page the member opens.
export async function markRead(conversationId: number): Promise<boolean> {
  requireIds(conversationId);
  try {
    await call(conversationsMarkRead, { conversationId });
    return true;
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    return false;
  }
}

// The "Mark as read" card, which the member presses after the page's own attempt failed: a refusal
// is theirs to hear about.
export async function markReadAction(
  conversationId: number,
): Promise<PanelState> {
  requireIds(conversationId);
  const marked = await attempt(`/conversations/${conversationId}`, () =>
    call(conversationsMarkRead, { conversationId }),
  );
  return marked.ok ? {} : { error: marked.error };
}

export type LeaveState = { error?: string };

export async function leaveAction(
  conversationId: number,
  _previous: LeaveState,
): Promise<LeaveState> {
  requireIds(conversationId);
  const left = await attempt(`/conversations/${conversationId}`, () =>
    call(conversationsLeave, { conversationId }),
  );
  if (!left.ok) return { error: left.error };
  redirect("/conversations");
}

export type PanelState = { error?: string };

// The conversations list shows each conversation's title and head count, and the router keeps a
// copy of that page for a while: without this, going back to it after a change would show the old
// ones.
async function backToConversation(conversationId: number): Promise<never> {
  revalidatePath("/[locale]/conversations", "layout");
  redirect(`/conversations/${conversationId}`);
}

export async function addParticipantsAction(
  conversationId: number,
  _previous: PanelState,
  formData: FormData,
): Promise<PanelState> {
  requireIds(conversationId);
  const userIds = formIds(formData, "recipientIds");
  const added = await attempt(`/conversations/${conversationId}`, () =>
    call(conversationsAddParticipants, { conversationId, userIds }),
  );
  if (!added.ok) return { error: added.error };
  return backToConversation(conversationId);
}

export async function renameAction(
  conversationId: number,
  _previous: PanelState,
  formData: FormData,
): Promise<PanelState> {
  requireIds(conversationId);
  const title = String(formData.get("title") ?? "");
  const renamed = await attempt(`/conversations/${conversationId}`, () =>
    call(conversationsRename, { conversationId, title }),
  );
  if (!renamed.ok) return { error: renamed.error };
  return backToConversation(conversationId);
}

// Locks or unlocks the conversation; the page that follows shows the new state.
export async function setLockedAction(
  conversationId: number,
  locked: boolean,
  _previous: PanelState,
): Promise<PanelState> {
  requireIds(conversationId);
  const changed = await attempt(`/conversations/${conversationId}`, () =>
    call(conversationsSetLocked, { conversationId, locked }),
  );
  if (!changed.ok) return { error: changed.error };
  return backToConversation(conversationId);
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
  const attachmentIds = formIds(formData, "attachmentIds");
  const created = await attempt("/conversations/new", () =>
    call(conversationsCreate, { title, recipientIds, body, attachmentIds }),
  );
  if (!created.ok) return { error: created.error, title };
  // The list beside the page is drawn by the layout, which a redirect between its pages keeps as
  // it was: without this it would not show the conversation just started.
  revalidatePath("/[locale]/conversations", "layout");
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
