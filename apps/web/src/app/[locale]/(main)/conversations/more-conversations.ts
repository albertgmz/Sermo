"use server";

import { conversationsPage } from "@/app/[locale]/(main)/conversations/conversation-page";

// The next page of the list, drawn on the server so the avatars keep reading the LITE cookie.
// Called as the visitor scrolls.
export async function moreConversations(cursor: string) {
  return conversationsPage(cursor);
}
