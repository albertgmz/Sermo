"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getClientInfo } from "@/lib/client";
import {
  createConversation,
  createMessage,
  getConversation,
  getUsers,
  markConversationRead,
} from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export async function sendMessage(conversationId: number, formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const body = String(formData.get("body") ?? "").trim();
  if (!body || !(await getConversation(conversationId, user.id))) return;
  await createMessage({
    conversationId,
    authorId: user.id,
    body,
    client: await getClientInfo(),
  });
  refresh();
}

export async function markRead(conversationId: number) {
  const user = await getCurrentUser();
  if (!user) return;
  await markConversationRead(conversationId, user.id);
  refresh();
}

export async function startConversation(
  _previous: string,
  formData: FormData,
): Promise<string> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations("conversations.actions.errors");
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const chosen = formData.getAll("to").map(Number);
  const participantIds = (await getUsers())
    .map((u) => u.id)
    .filter((id) => id !== user.id && chosen.includes(id));
  if (!participantIds.length) return t("recipientRequired");
  if (!title) return t("titleRequired");
  if (!body) return t("messageRequired");
  const conversation = await createConversation({
    title,
    authorId: user.id,
    participantIds,
    body,
    client: await getClientInfo(),
  });
  revalidatePath("/conversations", "layout");
  redirect(`/conversations/${conversation.id}`);
}
