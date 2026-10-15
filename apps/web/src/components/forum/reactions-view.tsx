import { type ReactionTarget, react } from "@/app/[locale]/(main)/actions";
import type { ReactionType } from "@/components/forum/reaction-button";
import { canReact, ReactionControl } from "@/components/forum/reaction-control";
import type { ReactionsSummary } from "@/components/forum/reaction-summary";
import { ReactionSummaryLive } from "@/components/forum/reaction-summary-live";
import { loadReactionUsers } from "@/components/forum/reaction-users-action";

// The backend's name of what each target reacts to, as the list of who reacted asks for it.
const CONTENT_TYPE = {
  post: "post",
  profilePost: "profile_post",
  profileComment: "profile_post_comment",
  message: "conversation_message",
} as const satisfies Record<ReactionTarget, string>;

// What `ReactionsView` draws, already shaped for the browser: `Reactions` shapes it on the server
// from the backend's types, and anything that carries it over (the picture viewer's details)
// sends this much and no more.
export type ReactionsData = {
  target: ReactionTarget;
  id: number;
  authorId: number;
  total: number;
  mine: number | null;
  // The counts by type, as the summary lists them.
  view: ReactionsSummary & { viewerTypeId: number | null };
  // What the picker offers, and the same with the viewer's own type kept when it is no longer
  // offered.
  picker: ReactionType[];
  offered: ReactionType[];
  // Whether the viewer may open the list of who reacted (`reaction.viewList`).
  viewList: boolean;
};

// The reactions of one item, drawn from shaped data: the one control (button, picker, summary)
// wherever an item is reacted to, on a page or in a viewer.
export function ReactionsView({
  data,
  viewerId,
  size,
  part,
  className,
}: {
  data: ReactionsData;
  viewerId: number | null;
  size?: "default" | "sm";
  // `button` and `summary` draw one half each, for a bar that keeps them apart.
  part?: "both" | "button" | "summary";
  className?: string;
}) {
  const { target, id, authorId, view, picker, offered } = data;
  const stateKey = `reaction:${target}:${id}`;
  const pressable = canReact(viewerId, authorId, offered);
  return (
    <ReactionControl
      stateKey={stateKey}
      action={react.bind(null, target, id)}
      total={data.total}
      viewerTypeId={data.mine}
      picker={offered}
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
            loadUsers={
              data.viewList
                ? loadReactionUsers.bind(null, CONTENT_TYPE[target], id)
                : undefined
            }
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
