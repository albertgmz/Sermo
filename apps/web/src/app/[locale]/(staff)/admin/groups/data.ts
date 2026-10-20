import "server-only";

import { groupsList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import type * as z from "zod";
import { inVisitorsLanguage } from "@/lib/builtin-groups";
import { call, read } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";

export type GroupItem = z.output<typeof groupsList.output>["items"][number];

// Groups as the panel shows them: a built-in group still carrying its default English text is
// named in the visitor's language. The stored text is not changed.
export async function inLanguage<
  T extends Parameters<typeof inVisitorsLanguage>[0],
>(groups: T[]): Promise<T[]> {
  const words = await getTranslations("lib.builtinGroups");
  return groups.map((group) => inVisitorsLanguage(group, words));
}

// The groups, once per request, for a screen only a holder of `admin.groups`, `admin.permissions`,
// `admin.promotions` or `admin.members` opens: the backend lets all four list them.
export const getGroups = cache(
  async (): Promise<GroupItem[]> =>
    inLanguage((await read(groupsList, {})).items),
);

// The groups, once per request, or null when the viewer may not list them: a screen opened with
// another permission (the upload settings) shows what it can without their names.
export const groupsIfAllowed = cache(async (): Promise<GroupItem[] | null> => {
  try {
    return await inLanguage((await call(groupsList, {})).items);
  } catch (error) {
    if (error instanceof SermoError && error.code === "forbidden") return null;
    throw error;
  }
});

// A name for a group id, or the fallback for one the list no longer has (a deleted group a log
// entry still names).
export function groupLabel(
  groups: GroupItem[],
  id: number,
  fallback: (id: number) => string,
) {
  return groups.find((group) => group.id === id)?.title ?? fallback(id);
}
