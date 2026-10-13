import { ConversationPreview } from "@/components/forum/conversation-preview";
import type { MemberView } from "@/lib/sermo/views";

// One row of the list of conversations: the preview, whose title link covers the whole row.
export function ConversationRow({
  conversation,
  member,
}: {
  conversation: Parameters<typeof ConversationPreview>[0]["conversation"];
  member: MemberView;
}) {
  return (
    <li className="relative flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
      <ConversationPreview linked conversation={conversation} member={member} />
    </li>
  );
}
