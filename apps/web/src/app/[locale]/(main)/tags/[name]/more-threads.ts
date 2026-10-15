"use server";

import { tagThreadsPage } from "@/app/[locale]/(main)/tags/[name]/tag-page";
import { call } from "@/lib/sermo/client";
import { endQuietly } from "@/lib/sermo/list-actions";

// A page of a tag's threads after the first, drawn on the server so the rows keep reading the
// session and the LITE cookie. Called as the visitor scrolls; `null` is the first page.
export async function moreTagThreads(name: string, cursor: string | null) {
  return endQuietly(() => tagThreadsPage(name, cursor ?? undefined, call));
}
