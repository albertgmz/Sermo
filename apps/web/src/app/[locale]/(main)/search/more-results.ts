"use server";

import type { Filters } from "./filters";
import { searchPage } from "./search-page";

// The next page of results, drawn on the server so the names keep reading the LITE cookie. Called
// as the visitor scrolls. A refusal of the backend here is a failed load: the list keeps what it
// shows and offers to try again.
export async function moreResults(
  filters: Filters,
  authorId: number | undefined,
  cursor: string,
) {
  const answer = await searchPage(filters, authorId, cursor);
  if ("message" in answer) throw new Error(answer.message);
  return answer.page;
}
