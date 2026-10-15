import "server-only";

import { pagesGet } from "@sermo/core/contracts";
import { call } from "./client";
import { SermoError } from "./errors";

// Whether the site publishes a page. Only "not found" means it does not; any other failure (a
// throttled visitor, an outage, a site closed to guests) is raised, because a caller that cannot
// tell must not act as if the page were absent. The answer's own flag counts: a visitor who may
// edit pages is given unpublished ones too.
export async function isPublished(slug: string): Promise<boolean> {
  try {
    return (await call(pagesGet, { slug })).isPublished;
  } catch (error) {
    if (error instanceof SermoError && error.code === "not_found") return false;
    throw error;
  }
}
