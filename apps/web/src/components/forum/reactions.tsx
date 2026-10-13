import { type ReactionTarget, react } from "@/app/(main)/actions";
import {
  ReactionButton,
  type ReactionType,
} from "@/components/forum/reaction-button";
import { ReactionSummary } from "@/components/forum/reaction-summary";
import { loadReactionUsers } from "@/components/forum/reaction-users-action";
import type { getReactionTypes } from "@/lib/sermo/reactions";
import { reactionsView } from "@/lib/sermo/reactions";
import { cn } from "@/lib/utils";

// The backend's name of what each target reacts to, as the list of who reacted asks for it.
const CONTENT_TYPE = {
  post: "post",
  profilePost: "profile_post",
  profileComment: "profile_post_comment",
  message: "conversation_message",
} as const satisfies Record<ReactionTarget, string>;

// The reactions of one item, the same wherever an item can be reacted to: the button that sets
// the viewer's own and the summary that opens who reacted.
export function Reactions({
  target,
  id,
  reactions,
  authorId,
  viewerId,
  picker,
  reactionTypes,
  size,
  className,
}: {
  target: ReactionTarget;
  id: number;
  reactions: {
    counts: Record<string, number>;
    total: number;
    mine: number | null;
  };
  authorId: number;
  viewerId: number | null;
  // What the picker offers; none when the viewer may not react to this item.
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
  size?: "default" | "sm";
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <ReactionButton
        action={react.bind(null, target, id)}
        total={reactions.total}
        viewerTypeId={reactions.mine}
        types={picker}
        viewerId={viewerId}
        authorId={authorId}
        size={size}
      />
      <ReactionSummary
        reactions={reactionsView(reactions, reactionTypes)}
        loadUsers={loadReactionUsers.bind(null, CONTENT_TYPE[target], id)}
        size={size}
      />
    </div>
  );
}
