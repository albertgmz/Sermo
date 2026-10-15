import "server-only";

import { reactionTypesList } from "@sermo/core/contracts";
import { getLocale } from "next-intl/server";
import { cache } from "react";
import type * as z from "zod";
import type { ReactionType } from "@/components/forum/reaction-button";
import type { ReactionPictureData } from "@/components/forum/reaction-picture";
import { liteBlocks } from "@/lib/lite-mode";
import { liteCategoryOfPurpose } from "@/lib/lite-preferences";
import { read } from "./client";

type RawReactionType = z.output<
  typeof reactionTypesList.output
>["items"][number];
declare const sealed: unique symbol;
// A reaction type that has been through LITE. Only `withoutBlockedPictures` makes one, and
// `asType`, `pickerTypes` and `reactionsView` take nothing else, so a raw backend type cannot
// reach a component that draws a picture.
export type ApiReactionType = RawReactionType & { readonly [sealed]: true };
type ApiSummary = {
  counts: Record<string, number>;
  total: number;
  mine: number | null;
};

// The one place a reaction picture meets LITE: when the visitor blocks the category the address
// is dropped here, so no later step can send it to the browser and the emoji is drawn instead.
export async function withoutBlockedPictures(
  types: RawReactionType[],
): Promise<ApiReactionType[]> {
  const blocked = await liteBlocks(liteCategoryOfPurpose("reaction_image"));
  return types.map(
    (type) =>
      (blocked
        ? { ...type, image: null, frames: null }
        : type) as ApiReactionType,
  );
}

// Every type, inactive ones included: old reactions keep showing with their emoji. Each carries
// what the visitor may do with it (`access`), and the hint of a locked one in the language the
// page is drawn in.
export const getReactionTypes = cache(async (): Promise<ApiReactionType[]> => {
  const language = (await getLocale()) === "es" ? "es" : "en";
  return withoutBlockedPictures(
    (await read(reactionTypesList, { language })).items,
  );
});

export function asType(type: ApiReactionType): ReactionType {
  return {
    id: type.id,
    key: String(type.id),
    label: type.title,
    emoji: type.emoji,
    picture: type.image
      ? ({ url: type.image.url, frames: type.frames } as ReactionPictureData)
      : null,
  };
}

// Whether a type may be given in a place: everywhere when it names no forums, else only in those
// forums. `forumId` is the forum the item is in, null for what is not in a forum (wall posts,
// comments, conversations), where a type limited to forums is not offered. The backend decides
// again when the reaction is given.
function usableIn(type: RawReactionType, forumId: number | null) {
  return (
    type.forumIds.length === 0 ||
    (forumId !== null && type.forumIds.includes(forumId))
  );
}

// What the picker offers on an item in `forumId`: the active types that may be given there, in
// the order the backend lists them. One the visitor's standing rules out is offered locked, with
// the hint, or left out when the type is set to hide.
export function pickerTypes(
  types: ApiReactionType[],
  forumId: number | null,
): ReactionType[] {
  return types
    .filter(
      (type) =>
        type.isActive && type.access !== "hidden" && usableIn(type, forumId),
    )
    .map((type) =>
      type.access === "locked"
        ? { ...asType(type), locked: type.lockHint ?? "" }
        : asType(type),
    );
}

// The viewer's own reaction when the picker no longer offers its type (set to hide, or limited to
// other forums since): shown greyed, so the button still draws it and takes it back. Nothing when
// the picker is empty (the viewer may not react here) or already holds it.
export function heldType(
  picker: ReactionType[],
  mine: number | null,
  types: ApiReactionType[],
): ReactionType | null {
  if (mine === null || picker.length === 0 || picker.some((t) => t.id === mine))
    return null;
  const type = types.find((entry) => entry.id === mine);
  return type ? { ...asType(type), locked: "" } : null;
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
