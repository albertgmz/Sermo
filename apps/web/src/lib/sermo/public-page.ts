import "server-only";

import { pagesGet } from "@sermo/core/contracts";
import { cacheLife, cacheTag } from "next/cache";
import type * as z from "zod";
import { callWith } from "./transport";

export type PublicPage = z.output<typeof pagesGet.output>;

// The tag of one page's shared read: saving or deleting the page renews it.
export const pageTag = (slug: string) => `page:${slug}`;

// A published page as a guest reads it: the same for every visitor, so it is asked without their
// cookies or address and shared. Read from the cache, the text is ready before the page's first
// HTML is sent, and a reader without JavaScript (a crawler, a policy checker) gets it there. The
// entry is kept for a week and renewed in the background after five minutes, so a page that few
// people open still answers from the cache. Null when a guest cannot have the page (not
// published, a site closed to guests) or the backend cannot be reached: the caller then reads it
// as the visitor. An error thrown out of a cached function fails the prerender, so none is.
export async function publicPage(slug: string): Promise<PublicPage | null> {
  "use cache";
  cacheTag(pageTag(slug));
  try {
    const page = await callWith({}, pagesGet, { slug });
    cacheLife({ stale: 300, revalidate: 300, expire: 604800 });
    return page;
  } catch {
    cacheLife({ stale: 30, revalidate: 5, expire: 600 });
    return null;
  }
}
