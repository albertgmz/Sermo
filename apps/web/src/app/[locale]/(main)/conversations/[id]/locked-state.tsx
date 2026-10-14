import type { conversationsGet } from "@sermo/core/contracts";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as z from "zod";
import { ReplyForm } from "@/app/[locale]/(main)/conversations/[id]/reply-form";
import { PostNote } from "@/components/forum/post-frame";

type Conversation = z.output<typeof conversationsGet.output>;

// In the header of a locked conversation.
export function LockedBadge() {
  const t = useTranslations("conversations.conversation");
  return (
    <span className="inline-flex h-10 items-center gap-1 text-sm text-muted-foreground">
      <Lock className="size-4" aria-hidden />
      {t("locked")}
    </span>
  );
}

// Below the messages: the reply form, with a note above it when the conversation is locked and the
// viewer may still reply; the note alone when they may not.
export function ReplyArea({ conversation }: { conversation: Conversation }) {
  const t = useTranslations("conversations.conversation");
  if (!conversation.canReply)
    return (
      <PostNote icon={Lock}>
        {conversation.isLocked ? t("lockedNote") : t("cannotReply")}
      </PostNote>
    );
  return (
    <>
      {conversation.isLocked && (
        <PostNote icon={Lock} className="mb-2">
          {t("lockedNote")}
        </PostNote>
      )}
      <ReplyForm
        conversationId={conversation.id}
        placeholder={t("placeholder")}
        submitLabel={t("submit")}
      />
    </>
  );
}
