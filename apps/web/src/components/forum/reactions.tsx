import { type ReactionTarget, react } from "@/app/[locale]/(main)/actions";
import type { ReactionType } from "@/components/forum/reaction-button";
import { canReact, ReactionControl } from "@/components/forum/reaction-control";
import { ReactionSummaryLive } from "@/components/forum/reaction-summary-live";
import { loadReactionUsers } from "@/components/forum/reaction-users-action";
import type { getReactionTypes } from "@/lib/sermo/reactions";
import { reactionsView } from "@/lib/sermo/reactions";

// The backend's name of what each target reacts to, as the list of who reacted asks for it.
const CONTENT_TYPE = {
  post: "post",
  profilePost: "profile_post",
  profileComment: "profile_post_comment",
  message: "conversation_message",
} as const satisfies Record<ReactionTarget, string>;

// The reactions of one item, the same wherever an item can be reacted to: put it first in the
// item's row of actions. It draws nothing when the viewer has nothing to press and nobody reacted.
export function Reactions({
  target,
  id,
  reactions,
  authorId,
  viewerId,
  picker,
  reactionTypes,
  size,
  part,
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
  // `button` and `summary` draw one half each, for a bar that keeps them apart.
  part?: "both" | "button" | "summary";
  className?: string;
}) {
  const view = reactionsView(reactions, reactionTypes);
  const stateKey = `reaction:${target}:${id}`;
  const pressable = canReact(viewerId, authorId, picker);
  return (
    <ReactionControl
      stateKey={stateKey}
      action={react.bind(null, target, id)}
      total={reactions.total}
      viewerTypeId={reactions.mine}
      picker={picker}
      viewerId={viewerId}
      authorId={authorId}
      // Where the viewer can react, the summary may gain its first reaction in place.
      summary={
        (view.total > 0 || pressable) && (
          <ReactionSummaryLive
            stateKey={stateKey}
            summary={view}
            drawnMine={view.viewerTypeId}
            offered={picker}
            loadUsers={loadReactionUsers.bind(null, CONTENT_TYPE[target], id)}
            size={size}
            showTotal={!pressable}
          />
        )
      }
      size={size}
      part={part}
      className={className}
    />
  );
}
