"use server";

import { conversationsGet } from "@sermo/core/contracts";
import type { ReactNode } from "react";
import {
  MessagesRegion,
  messagesContext,
  readMessages,
} from "@/app/[locale]/(main)/conversations/[id]/messages-region";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { drawnOrNull } from "@/lib/sermo/list-actions";
import { getMember } from "@/lib/sermo/session";

// A page of a conversation's messages, drawn as the conversation page draws it, for the pager that
// turns the pages in place (`PageSwitch`). The conversation is read again, so what the viewer may
// see and do there is the backend's answer of now. Null for a page with nothing on it (past the
// end) or one the backend refuses (the member left, the session ended): the browser then opens the
// address as a page of its own.
export async function messagesPage(
  conversationId: number,
  page: number,
): Promise<ReactNode | null> {
  requireIds(conversationId, page);
  return drawnOrNull(async () => {
    const [conversation, member, list] = await Promise.all([
      call(conversationsGet, { conversationId }),
      getMember(),
      readMessages(conversationId, page, call),
    ]);
    if (list.items.length === 0) return null;
    return (
      <MessagesRegion
        context={messagesContext(conversation, member)}
        page={page}
        list={list}
        inPlace
      />
    );
  });
}
