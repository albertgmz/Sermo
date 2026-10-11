"use client";

import { useState } from "react";
import { ReactionButton } from "@/components/forum/reaction-button";
import type { ReactionType } from "@/lib/types";

const OTHERS = 3;

export function ReactionDemo({
  types,
  initial = null,
  size,
}: {
  types: ReactionType[];
  initial?: number | null;
  size?: "default" | "sm";
}) {
  const [typeId, setTypeId] = useState(initial);
  return (
    <ReactionButton
      action={async (next) => setTypeId(next)}
      total={OTHERS + Number(typeId !== null)}
      viewerTypeId={typeId}
      types={types}
      viewerId={0}
      authorId={-1}
      size={size}
    />
  );
}
