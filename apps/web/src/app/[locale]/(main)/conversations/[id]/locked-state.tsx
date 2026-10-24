import type { conversationsGet } from "@sermo/core/contracts";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as z from "zod";
import { replyAction } from "@/app/[locale]/(main)/conversations/actions";
import { replyInPlace } from "@/app/[locale]/(main)/conversations/reply-in-place";
import { ReplyComposer } from "@/app/[locale]/(main)/threads/[id]/reply-composer";
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
export function ReplyArea({
  conversation,
  tailKey,
  canAttach = true,
}: {
  conversation: Conversation;
  tailKey: string;
  // Whether the viewer's groups allow attaching files to messages (`conversation.attach`).
  canAttach?: boolean;
}) {
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
      {/* The thread's quick reply; a conversation's files are uploaded without a forum. */}
      <ReplyComposer
        replyInPlace={replyInPlace.bind(null, conversation.id)}
        replyAction={replyAction.bind(null, conversation.id)}
        tailKey={tailKey}
        files={canAttach ? {} : null}
        placeholder={t("placeholder")}
        submitLabel={t("submit")}
      />
    </>
  );
}
