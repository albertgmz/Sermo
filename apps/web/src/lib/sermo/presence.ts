import "server-only";

import { usersRecentlyActive } from "@sermo/core/contracts";
import { cache } from "react";
import { readIfAllowed } from "./client";
import { SermoError } from "./errors";

// How long after they were last seen a member counts as online (XenForo's online window).
export const ONLINE_WINDOW_MS = 15 * 60_000;

// The members online now, for the online marks on avatars: those seen in the last 15 minutes among
// the members who show their online status (the backend leaves the others out, so they read as
// offline). Read once per request, every mark on the page sharing the answer. Null when the visitor
// may not see the member list or the read fails: then no mark is drawn, rather than every member
// marked offline.
export const onlineMembers = cache(
  async (): Promise<ReadonlySet<number> | null> => {
    try {
      const active = await readIfAllowed(usersRecentlyActive, {});
      if (!active) return null;
      const since = Date.now() - ONLINE_WINDOW_MS;
      return new Set(
        active.items
          .filter((item) => Date.parse(item.lastActivityAt) >= since)
          .map((item) => item.card.id),
      );
    } catch (error) {
      if (!(error instanceof SermoError)) throw error;
      console.error("The members online could not be read from the API", error);
      return null;
    }
  },
);
