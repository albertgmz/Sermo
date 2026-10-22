import "server-only";

import { smiliesList } from "@sermo/core/contracts";
import { cacheLife, cacheTag } from "next/cache";
import { cache } from "react";
import type { Smilie } from "@/lib/smilies";
import { callWith } from "./transport";

// The site's smilies, the same for every visitor: asked without the visitor's cookies and shared,
// like the site itself. Fresh for a minute. A failure is answered with none (the codes then show
// as typed) and asked for again after five seconds.
async function fetchSmilies(): Promise<Smilie[]> {
  "use cache";
  cacheTag("smilies");
  try {
    const { items } = await callWith({}, smiliesList, {});
    cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
    return items;
  } catch (error) {
    cacheLife({ stale: 30, revalidate: 5, expire: 600 });
    // `next build` prerenders without a backend, so nothing is logged during the build.
    if (process.env.NEXT_PHASE !== "phase-production-build")
      console.error("The smilies could not be read from the API", error);
    return [];
  }
}

// Outside a Next server (unit tests of the pages that show text) the cache cannot be used and
// throws: the text is then shown without smilies.
export const getSmilies = cache(async (): Promise<Smilie[]> => {
  try {
    return await fetchSmilies();
  } catch {
    return [];
  }
});
