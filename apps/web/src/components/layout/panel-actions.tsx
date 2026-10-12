"use server";

import {
  getRecentConversations,
  getRecentNotifications,
} from "@/components/layout/header-data";
import { AlertRows, MessageRows } from "@/components/layout/panel-rows";

// Draw the rows of a header panel on the server when the visitor opens it, so the avatars keep
// reading the LITE cookie and the page itself carries only the unread counts.
export async function loadConversations() {
  const { items, member } = await getRecentConversations();
  return <MessageRows conversations={items} member={member} />;
}

export async function loadAlerts() {
  const { entries, member } = await getRecentNotifications();
  return <AlertRows notifications={entries} member={member} />;
}
