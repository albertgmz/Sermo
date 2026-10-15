"use server";

import { notificationsPage } from "@/app/[locale]/(main)/notifications/notification-page";

// The next page of notifications, drawn on the server so the avatars keep reading the LITE cookie.
// Called as the visitor scrolls.
export async function moreNotifications(cursor: string) {
  return (await notificationsPage(cursor)).page;
}
