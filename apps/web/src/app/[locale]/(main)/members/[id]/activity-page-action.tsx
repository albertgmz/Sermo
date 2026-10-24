"use server";

import type { ReactNode } from "react";
import {
  type ActivityKind,
  ActivityPages,
  activityPage,
} from "@/app/[locale]/(main)/members/[id]/activity-page";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { drawnOrNull } from "@/lib/sermo/list-actions";

// A page of a member's posts or threads, drawn as the profile draws it, for the pager that turns
// the pages in place (`PageSwitch`). The kind comes from the browser and is checked here. Null for
// a page with nothing on it (past the end) or one the backend refuses: the browser then opens the
// address as a page of its own.
export async function activityPageAction(
  kind: ActivityKind,
  userId: number,
  page: number,
): Promise<ReactNode | null> {
  requireIds(userId, page);
  if (kind !== "posts" && kind !== "threads") return null;
  return drawnOrNull(async () => {
    const list = await activityPage(kind, userId, page, call);
    if (list.rows.length === 0) return null;
    return (
      <ActivityPages kind={kind} userId={userId} page={page} list={list} />
    );
  });
}
