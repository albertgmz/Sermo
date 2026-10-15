import type { ReactionTarget } from "@/app/[locale]/(main)/actions";
import type { ReactionType } from "@/components/forum/reaction-button";
import { ReactionsView } from "@/components/forum/reactions-view";
import type { getReactionTypes } from "@/lib/sermo/reactions";
import { reactionsData } from "@/lib/sermo/reactions";

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
  viewList = true,
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
  // Whether the viewer may open the list of who reacted (`reaction.viewList`).
  viewList?: boolean;
}) {
  return (
    <ReactionsView
      data={reactionsData(
        { target, id, authorId },
        reactions,
        picker,
        reactionTypes,
        viewList,
      )}
      viewerId={viewerId}
      size={size}
      part={part}
      className={className}
    />
  );
}
