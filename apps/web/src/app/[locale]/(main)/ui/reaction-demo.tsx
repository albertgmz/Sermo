"use client";

import { useId, useState } from "react";
import type { ReactionType } from "@/components/forum/reaction-button";
import { ReactionControl } from "@/components/forum/reaction-control";

// The shared reaction control with its backend left out: the viewer's own reaction is kept in
// state, the summary is drawn by the page.
export function ReactionDemo({
  types,
  others,
  summary,
  initial = null,
  own = false,
  size,
}: {
  types: ReactionType[];
  // How many others reacted.
  others: number;
  summary: React.ReactNode;
  initial?: number | null;
  // The viewer wrote the item: nothing to press.
  own?: boolean;
  size?: "default" | "sm";
}) {
  const [typeId, setTypeId] = useState(initial);
  const stateKey = `demo:${useId()}`;
  return (
    <ReactionControl
      stateKey={stateKey}
      action={async (next) => {
        setTypeId(next);
        return undefined;
      }}
      total={others + Number(typeId !== null)}
      viewerTypeId={typeId}
      picker={types}
      viewerId={0}
      authorId={own ? 0 : -1}
      summary={summary}
      size={size}
    />
  );
}
