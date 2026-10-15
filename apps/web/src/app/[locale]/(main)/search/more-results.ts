"use server";

import { SermoError } from "@/lib/sermo/errors";
import { endsTheList } from "@/lib/sermo/list-actions";
import type { Filters } from "./filters";
import { searchPage } from "./search-page";

// A page of results after the first, drawn on the server so the names keep reading the LITE
// cookie. Called as the visitor scrolls. A cursor the backend no longer follows or a session that
// is gone ends the list; any other refusal (a rate limit, say) is a failed load: the list keeps
// what it shows and offers to try again.
export async function moreResults(
  filters: Filters,
  authorId: number | undefined,
  cursor: string | null,
) {
  const answer = await searchPage(filters, authorId, cursor ?? undefined);
  if (!("message" in answer)) return answer.page;
  if (endsTheList(answer.code)) return { rows: [], nextCursor: null };
  // The refusal as it came, so restoring an address on a rate limit keeps the pages it has.
  throw new SermoError(answer.code, answer.status, answer.message);
}
