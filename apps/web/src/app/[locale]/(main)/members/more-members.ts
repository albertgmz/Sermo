"use server";

import { MEMBER_SORTS } from "@sermo/core/contracts";
import { directoryPage } from "@/app/[locale]/(main)/members/directory-page";
import { monthPage } from "@/app/[locale]/(main)/members/month-page";
import { rankingPage } from "@/app/[locale]/(main)/members/ranking-page";
import { VIEWS } from "@/app/[locale]/(main)/members/views";
import { call } from "@/lib/sermo/client";
import { endQuietly } from "@/lib/sermo/list-actions";

const EMPTY = { rows: [], nextCursor: null };

// A page of a ranking of all members after the first, drawn on the server so the avatars keep
// reading the LITE cookie. Called as the visitor scrolls; `null` is the first page. The view is
// one of the ranked ones, found here: what is drawn never comes from the browser.
export async function moreRanking(view: string, cursor: string | null) {
  const ranked = VIEWS.find((entry) => entry.value === view);
  if (!ranked || !("sort" in ranked)) return EMPTY;
  return endQuietly(() =>
    rankingPage(ranked.sort, ranked.ranking, cursor ?? undefined, call),
  );
}

export async function moreMonth(cursor: string | null) {
  return endQuietly(() => monthPage(cursor ?? undefined, call));
}

export async function moreDirectory(sort: string, cursor: string | null) {
  const chosen = MEMBER_SORTS.find((entry) => entry === sort);
  if (!chosen) return EMPTY;
  return endQuietly(() => directoryPage(chosen, cursor ?? undefined, call));
}
