"use server";

import { holdersPage } from "@/app/[locale]/(main)/awards/[id]/holders-page";
import { call } from "@/lib/sermo/client";
import { endQuietly } from "@/lib/sermo/list-actions";

// A page of an award's holders after the first, drawn on the server so the avatars keep reading
// the LITE cookie. Called as the visitor scrolls; `null` is the first page.
export async function moreHolders(awardId: number, cursor: string | null) {
  return endQuietly(() => holdersPage(awardId, cursor ?? undefined, call));
}
