"use server";

import { wallPage } from "@/app/[locale]/(main)/members/[id]/wall";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { endQuietly } from "@/lib/sermo/list-actions";

// A page of a member's wall after the first, drawn on the server so the bodies keep reading the
// LITE cookie: "Load more" puts it under the posts shown, in place.
export async function moreWall(profileId: number, cursor: string | null) {
  requireIds(profileId);
  if (cursor !== null && typeof cursor !== "string")
    return { rows: [], nextCursor: null };
  return endQuietly(() => wallPage(profileId, cursor, call));
}
