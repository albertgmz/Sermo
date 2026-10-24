"use server";

import type { ReactNode } from "react";
import {
  TagThreadPages,
  tagThreadsPage,
} from "@/app/[locale]/(main)/tags/[name]/tag-page";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { drawnOrNull } from "@/lib/sermo/list-actions";

// A page of a tag's threads, drawn as the tag page draws it, for the pager that turns the pages in
// place (`PageSwitch`). Null for a page with nothing on it (past the end) or one the backend
// refuses: the browser then opens the address as a page of its own.
export async function tagThreadsPageAction(
  name: string,
  page: number,
): Promise<ReactNode | null> {
  requireIds(page);
  return drawnOrNull(async () => {
    const list = await tagThreadsPage(String(name), page, call);
    if (list.rows.length === 0) return null;
    return <TagThreadPages name={name} page={page} list={list} />;
  });
}
