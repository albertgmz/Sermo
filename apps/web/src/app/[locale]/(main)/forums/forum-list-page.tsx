"use server";

import type { ReactNode } from "react";
import {
  ForumCategories,
  forumListChoice,
} from "@/app/[locale]/(main)/forums/forum-list";
import { queryOfSearch } from "@/components/forum/places";
import { SermoError } from "@/lib/sermo/errors";

// The section tabs and the categories of the section the address with `search` names, for a section
// tab pressed (`TabSwitch`): read again as a page load reads them. Null when the backend refuses:
// the browser then opens the address as a page of its own.
export async function forumSection(search: string): Promise<ReactNode | null> {
  if (typeof search !== "string") return null;
  const { section, stats } = forumListChoice(queryOfSearch(search));
  try {
    // Awaited here, so that a refusal is this answer's and not a broken part of the page.
    return await ForumCategories({ section, stats });
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
}
