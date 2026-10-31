import "server-only";

import { pagesGet } from "@sermo/core/contracts";
import { call } from "./client";
import { SermoError } from "./errors";
import { publicPage } from "./public-page";

// The slug of the page an administrator writes the cookie policy's prose in. The policy page draws
// the inventory itself; this page is only the words around it.
export const POLICY_PAGE_SLUG = "cookies";

// The administrator's text for the cookie policy page, or null when none is published (the page
// then shows the draft that ships with the site). The shared read first, so the text is in the
// page's first HTML; as the visitor when a guest cannot have it.
export async function getCookiePolicyText() {
  const shared = await publicPage(POLICY_PAGE_SLUG);
  if (shared) return shared;
  try {
    return await call(pagesGet, { slug: POLICY_PAGE_SLUG });
  } catch (error) {
    if (error instanceof SermoError && error.code === "not_found") return null;
    throw error;
  }
}
