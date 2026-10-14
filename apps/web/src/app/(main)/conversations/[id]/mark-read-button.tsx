"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { markRead } from "@/app/(main)/conversations/actions";
import { Button } from "@/components/ui/button";

// Records the conversation as read and redraws the page, which also refreshes the unread counts
// in the site's frame. Drawn only while the latest message is unread.
export function MarkReadButton({ conversationId }: { conversationId: number }) {
  const t = useTranslations("conversations.conversation");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="p-4">
      <Button
        type="button"
        variant="outline"
        className="h-10 w-full px-3"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await markRead(conversationId);
            router.refresh();
          })
        }
      >
        <Check />
        {t("markRead")}
      </Button>
    </div>
  );
}
