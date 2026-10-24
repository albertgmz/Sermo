import { conversationsLocateUnread } from "@sermo/core/contracts";
import { notFound, redirect } from "next/navigation";
import { conversationHref } from "@/app/[locale]/(main)/conversations/[id]/message-target";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";

// Where the viewer picks a conversation up: its first unread message, or its newest once all is
// read. A page load is settled by the proxy; this page answers a soft navigation.
export default async function ConversationUnreadPage({
  params,
}: PageProps<"/[locale]/conversations/[id]/unread">) {
  const conversationId = parseId((await params).id);
  if (conversationId === null) notFound();
  const message = await read(conversationsLocateUnread, { conversationId });
  redirect(
    conversationHref(message.conversationId, message.messageId, message.page),
  );
}
