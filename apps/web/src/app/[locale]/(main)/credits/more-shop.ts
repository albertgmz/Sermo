"use server";

import { shopPage } from "@/app/[locale]/(main)/credits/shop";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { endQuietly } from "@/lib/sermo/list-actions";
import { getViewer } from "@/lib/sermo/session";

// A page of a shop category after the first, drawn on the server: "Load more" puts it under the
// items shown, in place.
export async function moreShop(categoryId: number, cursor: string | null) {
  requireIds(categoryId);
  if (cursor !== null && typeof cursor !== "string")
    return { rows: [], nextCursor: null };
  const { user } = await getViewer();
  return endQuietly(() =>
    shopPage(
      categoryId,
      cursor ?? undefined,
      user && { id: user.id, username: user.username },
      call,
    ),
  );
}
