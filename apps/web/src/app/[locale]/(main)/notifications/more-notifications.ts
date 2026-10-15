"use server";

import { notificationsPage } from "@/app/[locale]/(main)/notifications/notification-page";
import { call } from "@/lib/sermo/client";
import { endQuietly } from "@/lib/sermo/list-actions";

// A page of notifications after the first, drawn on the server so the avatars keep reading the
// LITE cookie. Called as the visitor scrolls; `null` is the first page.
export async function moreNotifications(cursor: string | null) {
  return endQuietly(
    async () => (await notificationsPage(cursor ?? undefined, call)).page,
  );
}
