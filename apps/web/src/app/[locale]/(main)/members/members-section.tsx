"use server";

import type { ReactNode } from "react";
import {
  type MembersPath,
  MembersView,
  membersParams,
} from "@/app/[locale]/(main)/members/members-view";
import { queryOfSearch } from "@/components/forum/places";
import { SermoError } from "@/lib/sermo/errors";

// The members section as the address with `search` on `path` draws it, for a view, a sort, a search
// or a month changed in place (`TabSwitch`): read again as a page load reads it. Null when the
// backend refuses: the browser then opens the address as a page of its own, which says what is the
// matter.
export async function membersSection(
  path: MembersPath,
  search: string,
): Promise<ReactNode | null> {
  if (path !== "/members" && path !== "/members/month") return null;
  if (typeof search !== "string") return null;
  const query = queryOfSearch(search);
  // The standing of a month has one address (the page sends `?view=month` there).
  if (path === "/members" && query.view === "month") return null;
  try {
    return await MembersView({
      params: membersParams(query, path),
      inPlace: true,
    });
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
}
