"use client";

import type { ReactionType } from "@/components/forum/reaction-button";
import {
  ReactionSummary,
  type ReactionsSummary,
} from "@/components/forum/reaction-summary";
import { useItemState } from "@/lib/item-state";
import { withViewerReaction } from "@/lib/reaction-state";

// The summary of an item as the viewer's own reaction changes it: it follows the button of the
// same item (`stateKey`) without the page being drawn again.
export function ReactionSummaryLive({
  stateKey,
  summary,
  drawnMine,
  offered,
  ...rest
}: {
  stateKey: string;
  // What the server drew, and the viewer's reaction in it.
  summary: ReactionsSummary;
  drawnMine: number | null;
  offered: ReactionType[];
} & Omit<React.ComponentProps<typeof ReactionSummary>, "reactions">) {
  const mine = useItemState(stateKey, drawnMine);
  return (
    <ReactionSummary
      reactions={withViewerReaction(summary, drawnMine, mine, offered)}
      {...rest}
    />
  );
}
