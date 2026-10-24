"use server";

import type { ReactNode } from "react";
import {
  ConversationPages,
  conversationsPage,
} from "@/app/[locale]/(main)/conversations/conversation-page";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { drawnOrNull } from "@/lib/sermo/list-actions";

// A page of the member's conversations, drawn as the list page draws it, for the pager that turns
// the pages in place (`PageSwitch`). Null for a page with nothing on it (past the end) or one the
// backend refuses (a session that ended): the browser then opens the address as a page of its own.
export async function conversationsPageAction(
  page: number,
): Promise<ReactNode | null> {
  requireIds(page);
  return drawnOrNull(async () => {
    const list = await conversationsPage(page, call);
    if (list.rows.length === 0) return null;
    return <ConversationPages page={page} list={list} />;
  });
}
