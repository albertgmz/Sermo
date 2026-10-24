"use server";

import type { ReactNode } from "react";
import { feedColumnOf } from "@/app/[locale]/(main)/novedades/feed-column";
import { SermoError } from "@/lib/sermo/errors";

// The feed's main column as the address with `search` draws it, for a tab or a filter changed in
// place (`TabSwitch`). Null when the backend refuses: the browser then opens the address as a page
// of its own, which says what is the matter.
export async function feedColumn(search: string): Promise<ReactNode | null> {
  if (typeof search !== "string") return null;
  try {
    return await feedColumnOf(search);
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
}
