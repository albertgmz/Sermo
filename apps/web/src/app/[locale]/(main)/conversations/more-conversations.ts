"use server";

import { conversationsPage } from "@/app/[locale]/(main)/conversations/conversation-page";
import { call } from "@/lib/sermo/client";
import { endQuietly } from "@/lib/sermo/list-actions";

// A page of the list after the first, drawn on the server so the avatars keep reading the LITE
// cookie. Called as the visitor scrolls; `null` is the first page.
export async function moreConversations(cursor: string | null) {
  return endQuietly(() => conversationsPage(cursor ?? undefined, call));
}
