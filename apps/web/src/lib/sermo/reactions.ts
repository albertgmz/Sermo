import "server-only";

import { reactionTypesList } from "@sermo/core/contracts";
import { cache } from "react";
import type * as z from "zod";
import type { ReactionType } from "@/components/forum/reaction-button";
import { liteBlocks } from "@/lib/lite-mode";
import { liteCategoryOfPurpose } from "@/lib/lite-preferences";
import { read } from "./client";

type ApiReactionType = z.output<
  typeof reactionTypesList.output
>["items"][number];
type ApiSummary = {
  counts: Record<string, number>;
  total: number;
  mine: number | null;
};

// The one place a reaction picture meets LITE: when the visitor blocks the category the address
// is dropped here, so no later step can send it to the browser and the emoji is drawn instead.
export async function withoutBlockedPictures(
  types: ApiReactionType[],
): Promise<ApiReactionType[]> {
  if (!(await liteBlocks(liteCategoryOfPurpose("reaction_image"))))
    return types;
  return types.map((type) => ({ ...type, image: null, frames: null }));
}

// Every type, inactive ones included: old reactions keep showing with their emoji.
export const getReactionTypes = cache(
  async (): Promise<ApiReactionType[]> =>
    withoutBlockedPictures((await read(reactionTypesList, {})).items),
);

export function asType(type: ApiReactionType): ReactionType {
  return {
    id: type.id,
    key: String(type.id),
    label: type.title,
    emoji: type.emoji,
    picture: type.image ? { url: type.image.url, frames: type.frames } : null,
  };
}

// What the picker offers: the active types, in the order the backend lists them.
export function pickerTypes(types: ApiReactionType[]): ReactionType[] {
  return types.filter((type) => type.isActive).map(asType);
}

// The summary of an item in the shape the reaction components take.
export function reactionsView(summary: ApiSummary, types: ApiReactionType[]) {
  const byType = types.flatMap((type) => {
    const count = summary.counts[String(type.id)];
    return count ? [{ type: asType(type), count }] : [];
  });
  return {
    total: summary.total,
    byType: byType.toSorted((a, b) => b.count - a.count),
    viewerTypeId: summary.mine,
  };
}
