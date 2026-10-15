"use server";

import { historyPage } from "@/app/[locale]/(main)/credits/history-page";
import { call } from "@/lib/sermo/client";
import { endQuietly } from "@/lib/sermo/list-actions";

// A page of the ledger after the first, drawn on the server. Called as the visitor scrolls; `null`
// is the first page.
export async function moreHistory(cursor: string | null) {
  return endQuietly(() => historyPage(cursor ?? undefined, call));
}
