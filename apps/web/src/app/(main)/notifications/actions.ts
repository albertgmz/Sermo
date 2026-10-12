"use server";

import { notificationsMarkRead } from "@sermo/core/contracts";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { attempt } from "@/lib/sermo/outcome";

// The form sits in the header panel too, so the member goes back to the page
// they sent it from.
async function origin() {
  const referer = (await headers()).get("referer");
  if (!referer || !URL.canParse(referer)) return "/notifications";
  const { pathname, search } = new URL(referer);
  return pathname.startsWith("//") ? "/notifications" : pathname + search;
}

export type MarkAllState = { error?: string };

export async function markAllRead(
  _previous: MarkAllState,
): Promise<MarkAllState> {
  const marked = await attempt("/notifications", () =>
    call(notificationsMarkRead, { all: true }),
  );
  if (!marked.ok) return { error: marked.error };
  redirect(await origin());
}

// Called when a notification is opened, so a refusal is nothing the visitor needs to hear about.
// The page stays as it is; the unread count is right on the next page the member opens.
export async function markOneRead(id: number) {
  try {
    await call(notificationsMarkRead, { ids: [id] });
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
  }
}
