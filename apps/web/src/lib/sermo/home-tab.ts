import "server-only";

import { siteHomeTab } from "@sermo/core/contracts";
import { cacheLife, cacheTag } from "next/cache";
import type { HomeTab } from "@/lib/home-tabs";
import { read } from "./client";
import { callWith } from "./transport";

// What every guest opens on: the same for all of them, so it is asked without the visitor's
// cookies or address and shared, like the site itself (tag `site`, renewed when the setting is
// saved). A failure is answered with Latest and asked for again after five seconds.
async function guestTab(): Promise<HomeTab> {
  "use cache";
  cacheTag("site");
  try {
    const { tab } = await callWith({}, siteHomeTab, {});
    cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
    return tab;
  } catch (error) {
    cacheLife({ stale: 30, revalidate: 5, expire: 600 });
    // `next build` prerenders without a backend, so nothing is logged during the build.
    if (process.env.NEXT_PHASE !== "phase-production-build")
      console.error("The home tab could not be read from the API", error);
    return "latest";
  }
}

// The tab the site's rules give a visitor who chose none (a member's own choice comes with the
// session, so this is not asked for one who has chosen).
export async function getDefaultTab(signedIn: boolean): Promise<HomeTab> {
  return signedIn ? (await read(siteHomeTab, {})).tab : guestTab();
}
