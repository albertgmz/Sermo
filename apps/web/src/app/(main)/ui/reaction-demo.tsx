"use client";

import { useState } from "react";
import {
  ReactionButton,
  type ReactionType,
} from "@/components/forum/reaction-button";

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
      action={async (next) => {
        setTypeId(next);
        return undefined;
      }}
      total={OTHERS + Number(typeId !== null)}
      viewerTypeId={typeId}
      types={types}
      viewerId={0}
      authorId={-1}
      size={size}
    />
  );
}
