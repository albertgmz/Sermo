import "server-only";

import { groupsList } from "@sermo/core/contracts";
import { cache } from "react";
import type * as z from "zod";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";

export type GroupItem = z.output<typeof groupsList.output>["items"][number];

// The groups, once per request, or null when the viewer may not list them. Listing groups needs
// `admin.groups`, which the screens of promotions and permissions do not: they then work from
// the ids alone instead of failing.
export const groupsIfAllowed = cache(async (): Promise<GroupItem[] | null> => {
  try {
    return (await call(groupsList, {})).items;
  } catch (error) {
    if (error instanceof SermoError && error.code === "forbidden") return null;
    throw error;
  }
});

// A name for a group id on a screen that may not have the list.
export function groupLabel(
  groups: GroupItem[] | null,
  id: number,
  fallback: (id: number) => string,
) {
  return groups?.find((group) => group.id === id)?.title ?? fallback(id);
}
