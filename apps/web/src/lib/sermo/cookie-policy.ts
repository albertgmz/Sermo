import "server-only";

import { pagesGet } from "@sermo/core/contracts";
import { call } from "./client";
import { SermoError } from "./errors";

// The slug of the page an administrator writes the cookie policy's prose in. The policy page draws
// the inventory itself; this page is only the words around it.
export const POLICY_PAGE_SLUG = "cookies";

// The administrator's text for the cookie policy page, or null when none is published (the page
// then shows the draft that ships with the site).
export async function getCookiePolicyText() {
  try {
    return await call(pagesGet, { slug: POLICY_PAGE_SLUG });
  } catch (error) {
    if (error instanceof SermoError && error.code === "not_found") return null;
    throw error;
  }
}
