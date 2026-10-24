"use server";

import { MEMBER_SORTS } from "@sermo/core/contracts";
import type { ReactNode } from "react";
import {
  DirectoryPages,
  directoryPage,
} from "@/app/[locale]/(main)/members/directory-page";
import {
  RankingPages,
  rankingPage,
} from "@/app/[locale]/(main)/members/ranking-page";
import { VIEWS } from "@/app/[locale]/(main)/members/views";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { drawnOrNull } from "@/lib/sermo/list-actions";

// A page of a ranking of all members, drawn as the members page draws it, for the pager that turns
// the pages in place (`PageSwitch`). The view comes from the browser and is one of the ranked ones,
// found here: what is drawn never comes from the browser. Null for a page with nothing on it (past
// the end), a view that is no ranking, or one the backend refuses: the browser then opens the
// address as a page of its own.
export async function rankingPageAction(
  view: string,
  page: number,
): Promise<ReactNode | null> {
  requireIds(page);
  const ranked = VIEWS.find((entry) => entry.value === view);
  if (!ranked || !("sort" in ranked)) return null;
  return drawnOrNull(async () => {
    const list = await rankingPage(ranked.sort, ranked.ranking, page, call);
    if (list.rows.length === 0) return null;
    return <RankingPages view={ranked.value} page={page} list={list} />;
  });
}

// A page of the member directory, drawn the same way, null for a sort that is not one.
export async function directoryPageAction(
  sort: string,
  page: number,
): Promise<ReactNode | null> {
  requireIds(page);
  const chosen = MEMBER_SORTS.find((entry) => entry === sort);
  if (!chosen) return null;
  return drawnOrNull(async () => {
    const list = await directoryPage(chosen, page, call);
    if (list.total === 0) return null;
    return <DirectoryPages sort={chosen} page={page} list={list} />;
  });
}
