"use server";

import { ONLINE_TYPES, onlineList } from "@sermo/core/contracts";
import type { ReactNode } from "react";
import {
  OnlineRegion,
  type OnlineType,
} from "@/app/[locale]/(main)/online/online-list";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { requireIds } from "@/lib/sermo/ids";

// A page of the current visitors, drawn as the page draws it, for the pager that turns the pages
// in place (`PageSwitch`). Null when there is nothing to show in place (an empty page past the
// last, a refusal): the browser then opens the address as a page of its own.
export async function onlinePage(
  type: OnlineType,
  page: number,
): Promise<ReactNode | null> {
  requireIds(page);
  if (!ONLINE_TYPES.includes(type) || page > 10_000) return null;
  try {
    const answer = await call(onlineList, { type, page });
    if (answer.items.length === 0 && page > 1) return null;
    return <OnlineRegion type={type} answer={answer} />;
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
}
