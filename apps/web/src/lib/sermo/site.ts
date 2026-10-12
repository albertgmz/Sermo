import "server-only";

import { siteGet } from "@sermo/core/contracts";
import { cacheLife, cacheTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { callWith } from "./transport";

export type SiteIdentity = {
  name: string;
  logo: { fileId: number; url: string } | null;
  icon: { fileId: number; url: string } | null;
  backdrop: { fileId: number; url: string } | null;
};

// The same for every visitor: asked without the visitor's cookies or address, so the answer can be
// shared. An error thrown out of a cached function fails the prerender, so a failure is answered
// here with the fallback, which is asked for again after five seconds instead of a minute.
async function fetchSite(defaultName: string): Promise<SiteIdentity> {
  "use cache";
  cacheTag("site");
  try {
    const { name, logo, icon, backdrop } = await callWith({}, siteGet, {});
    // Fresh for a minute, so a change in the administration panel shows up without a deploy. The
    // expiry is above five minutes, which keeps the entry part of prerendered output.
    cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
    return { name, logo, icon, backdrop };
  } catch (error) {
    // The expiry stays above five minutes: a shorter entry is left out of the prerender and the
    // build then reports a cache miss for every page.
    cacheLife({ stale: 30, revalidate: 5, expire: 600 });
    // `next build` prerenders without a backend, so nothing is logged during the build.
    if (process.env.NEXT_PHASE !== "phase-production-build")
      console.error("The site could not be read from the API", error);
    return { name: defaultName, logo: null, icon: null, backdrop: null };
  }
}

// The default name is read here because a cached function cannot read the request's language.
export const getSite = cache(async (): Promise<SiteIdentity> => {
  const t = await getTranslations("layout.site");
  return fetchSite(t("defaultName"));
});
