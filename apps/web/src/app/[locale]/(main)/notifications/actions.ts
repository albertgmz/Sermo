"use server";

import { notificationsMarkRead } from "@sermo/core/contracts";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";

export type MarkAllState = { error?: string };

export async function markAllRead(
  _previous: MarkAllState,
): Promise<MarkAllState> {
  const marked = await attempt("/notifications", () =>
    call(notificationsMarkRead, { all: true }),
  );
  // The form sits in the page and in the header panel: the client refreshes the route behind it.
  return marked.ok ? {} : { error: marked.error };
}

// Called when a notification is opened, so a refusal is nothing the visitor needs to hear about.
// The page stays as it is; the unread count is right on the next page the member opens.
export async function markOneRead(id: number) {
  requireIds(id);
  try {
    await call(notificationsMarkRead, { ids: [id] });
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
  }
}
