import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import {
  type ClientNamespace,
  pickClientMessages,
} from "@/i18n/client-messages";
import { MoreMessages } from "./more-messages";

// Adds interface text for the client components under it to what the layouts above already send.
// The namespaces are a literal list: `tests/client-messages.test.ts` reads it.
export async function ClientMessages({
  namespaces,
  children,
}: {
  namespaces: readonly ClientNamespace[];
  children: ReactNode;
}) {
  const messages = await getMessages();
  return (
    <MoreMessages
      messages={pickClientMessages(
        messages as Parameters<typeof pickClientMessages>[0],
        namespaces,
      )}
    >
      {children}
    </MoreMessages>
  );
}
