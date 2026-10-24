"use server";

import {
  conversationsAddParticipants,
  conversationsCreate,
  conversationsDeleteMessage,
  conversationsHardDeleteMessage,
  conversationsLeave,
  conversationsMarkRead,
  conversationsMarkUnread,
  conversationsQuoteMessage,
  conversationsRename,
  conversationsSetLocked,
  usersSearch,
} from "@sermo/core/contracts";
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conversationHref } from "@/app/[locale]/(main)/conversations/[id]/message-target";
import { saveMessageEdit } from "@/app/[locale]/(main)/conversations/save-message-edit";
import { sendMessage } from "@/app/[locale]/(main)/conversations/send-message";
import { authorName, memberIdOf } from "@/lib/sermo/authors";
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
  const sent = await sendMessage(conversationId, formData);
  if (!sent.ok) return { error: sent.error };
  // The member lands on their message, on the page that holds it, rendered afresh.
  redirect(conversationHref(conversationId, sent.value.id));
}

// What a message's Quote puts in the editor: its author and its BB code source, which the backend
// gives a participant for a visible message. A refusal (a message deleted meanwhile) quotes nothing.
export async function quoteMessageSource(messageId: number) {
  requireIds(messageId);
  try {
    const { author, bodySource } = await call(conversationsQuoteMessage, {
      messageId,
    });
    return {
      author: authorName(author),
      authorId: memberIdOf(author),
      source: bodySource,
    };
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    return null;
  }
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

// Saves an edited message (`saveMessageEdit`) and goes back to it.
export async function editMessageAction(
  conversationId: number,
  messageId: number,
  _previous: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  const saved = await saveMessageEdit(conversationId, messageId, formData);
  if (!saved.ok) return { error: saved.error };
  redirect(conversationHref(conversationId, messageId));
}

// Deletes a message (its author or a moderator, as the backend allows) and draws the page again.
// The delete dialog's `hardDelete` field asks for erasing it for good, in whatever state it is.
export async function deleteMessageAction(
  conversationId: number,
  messageId: number,
  _previous: ReplyState,
  formData?: FormData,
): Promise<ReplyState> {
  requireIds(conversationId, messageId);
  const reason = String(formData?.get("reason") ?? "");
  const deleted = await attempt(`/conversations/${conversationId}`, () =>
    formData?.get("hardDelete") === "1"
      ? call(conversationsHardDeleteMessage, { messageId, reason })
      : call(conversationsDeleteMessage, { messageId, reason }),
  );
  if (!deleted.ok) return { error: deleted.error };
  refresh();
  return {};
}

export type LeaveState = { error?: string };

// Leaving keeps XenForo's choice: the form's `futureMessages` radio is "accept" (the default: a
// new reply brings the conversation back) or "ignore".
export async function leaveAction(
  conversationId: number,
  _previous: LeaveState,
  formData: FormData,
): Promise<LeaveState> {
  requireIds(conversationId);
  const futureMessages =
    formData.get("futureMessages") === "ignore" ? "ignore" : "accept";
  const left = await attempt(`/conversations/${conversationId}`, () =>
    call(conversationsLeave, { conversationId, futureMessages }),
  );
  if (!left.ok) return { error: left.error };
  redirect("/conversations");
}

// "Mark as unread" puts the conversation back among the unread ones and goes to the list: the
// conversation page marks itself read as soon as it opens, so staying on it would undo this. The
// list in the frame (counts, popup) is drawn afresh.
export async function markUnreadAction(
  conversationId: number,
  _previous: LeaveState,
): Promise<LeaveState> {
  requireIds(conversationId);
  const marked = await attempt(`/conversations/${conversationId}`, () =>
    call(conversationsMarkUnread, { conversationId }),
  );
  if (!marked.ok) return { error: marked.error };
  revalidatePath("/[locale]/conversations", "layout");
  redirect("/conversations");
}

export type PanelState = { error?: string; done?: boolean };

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

// The header's Edit dialog: the title and the lock, each saved only when it changed (a field the
// dialog does not offer is not in the form). The page is drawn again where it is, with the list in
// the frame, once anything was saved, even when a later change was refused.
export async function editConversationAction(
  conversationId: number,
  _previous: PanelState,
  formData: FormData,
): Promise<PanelState> {
  requireIds(conversationId);
  const here = `/conversations/${conversationId}`;
  const title = formData.get("title");
  const renaming =
    typeof title === "string" && title !== formData.get("titleWas");
  const locked = formData.get("locked") === "1";
  const relocking =
    formData.has("lockedWas") && locked !== (formData.get("lockedWas") === "1");
  if (renaming) {
    const renamed = await attempt(here, () =>
      call(conversationsRename, { conversationId, title }),
    );
    if (!renamed.ok) return { error: renamed.error };
  }
  const relocked = relocking
    ? await attempt(here, () =>
        call(conversationsSetLocked, { conversationId, locked }),
      )
    : null;
  if (renaming || relocked?.ok)
    revalidatePath("/[locale]/conversations", "layout");
  return relocked && !relocked.ok ? { error: relocked.error } : { done: true };
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
