"use server";

import type { ReactNode } from "react";
import { Content } from "@/app/[locale]/(main)/credits/content";
import { queryOfSearch } from "@/components/forum/places";
import { SermoError } from "@/lib/sermo/errors";

// The credits page's tabs and the open one as the address with `search` names them, for a tab, a
// shop category or an inventory list changed in place (`TabSwitch`): read again as a page load reads
// them. Null when the backend refuses: the browser then opens the address as a page of its own.
export async function creditsContent(
  search: string,
): Promise<ReactNode | null> {
  if (typeof search !== "string") return null;
  try {
    return await Content({ query: queryOfSearch(search) });
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
}
