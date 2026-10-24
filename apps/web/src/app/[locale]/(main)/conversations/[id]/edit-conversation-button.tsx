"use client";

import type { conversationsGet } from "@sermo/core/contracts";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as z from "zod";
import type { EditConversationPopupProps } from "@/app/[locale]/(main)/conversations/[id]/edit-conversation-popup";
import { buttonVariants } from "@/components/ui/button";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { cn } from "@/lib/utils";

type Conversation = z.output<typeof conversationsGet.output>;

const loadPopup = () =>
  import("@/app/[locale]/(main)/conversations/[id]/edit-conversation-popup");

// As the header's other buttons; on a phone the hidden label stays the button's name.
export const editConversationClass = cn(
  buttonVariants({ variant: "ghost" }),
  "h-10 px-2 text-xs text-muted-foreground",
);

// "Edit" in the conversation's header, first of its buttons as XenForo's: the title (for its
// starter) and the lock (for its starter and the moderators) in a dialog over the page. Drawn only
// for a viewer who may change one of them; the dialog's code comes with the first reach for it.
export function EditConversationButton({
  conversation,
}: {
  conversation: Pick<
    Conversation,
    "id" | "title" | "isLocked" | "canRename" | "canLock"
  >;
}) {
  const t = useTranslations("conversations.conversation.edit");
  if (!conversation.canRename && !conversation.canLock) return null;
  const popup: EditConversationPopupProps = {
    conversationId: conversation.id,
    title: conversation.canRename ? conversation.title : null,
    locked: conversation.canLock ? conversation.isLocked : null,
    label: t("open"),
    heading: t("title"),
  };
  return (
    <LazyPopup
      load={loadPopup}
      popup={popup}
      trigger={(lazy) => (
        <button
          type="button"
          aria-haspopup="dialog"
          className={editConversationClass}
          {...lazy}
        >
          <Pencil aria-hidden="true" />
          <span className="max-sm:sr-only">{popup.label}</span>
        </button>
      )}
    />
  );
}
