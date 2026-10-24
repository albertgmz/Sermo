import { conversationsLocateMessage } from "@sermo/core/contracts";
import { notFound, redirect } from "next/navigation";
import { conversationHref } from "@/app/[locale]/(main)/conversations/[id]/message-target";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";

// A message has no page of its own: its address (an alert's, an e-mail's, the old forum's after
// the proxy's redirect) goes to its conversation, at the page that holds it. A page load is settled
// by the proxy; this page answers a soft navigation and a request the proxy let through.
export default async function MessagePage({
  params,
}: PageProps<"/[locale]/conversations/messages/[id]">) {
  const messageId = parseId((await params).id);
  if (messageId === null) notFound();
  const message = await read(conversationsLocateMessage, { messageId });
  redirect(
    conversationHref(message.conversationId, message.messageId, message.page),
  );
}
