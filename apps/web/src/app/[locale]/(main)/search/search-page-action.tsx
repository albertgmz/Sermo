"use server";

import type { ReactNode } from "react";
import { requireIds } from "@/lib/sermo/ids";
import { drawnOrNull } from "@/lib/sermo/list-actions";
import type { Filters } from "./filters";
import { SearchPages, searchPage } from "./search-page";

// A page of results, drawn as the results page draws it, for the pager that turns the pages in
// place (`PageSwitch`). The filters come back from the browser, and the backend checks them as it
// does a request of its own. Null for a page with nothing on it (past the end) or one the backend
// refuses (a rate limit, say): the browser then opens the address as a page of its own, which
// says what is the matter.
export async function searchPageAction(
  filters: Filters,
  authorId: number | undefined,
  page: number,
): Promise<ReactNode | null> {
  requireIds(page, ...(authorId === undefined ? [] : [authorId]));
  return drawnOrNull(async () => {
    const answer = await searchPage(filters, authorId, page);
    if ("message" in answer || answer.results.rows.length === 0) return null;
    return <SearchPages filters={filters} page={page} list={answer.results} />;
  });
}
