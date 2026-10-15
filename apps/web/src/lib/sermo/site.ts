import "server-only";

import { type Analytics, siteGet } from "@sermo/core/contracts";
import { cacheLife, cacheTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import type * as z from "zod";
import { POLICY_VERSION } from "@/lib/consent/inventory";
import { policyVersion } from "@/lib/consent/state";
import { callWith } from "./transport";

export type SiteIdentity = {
  name: string;
  // What the site says about itself, for the default page description and the footer; empty when
  // the owner wrote nothing.
  description: string;
  logo: { fileId: number; url: string } | null;
  icon: { fileId: number; url: string } | null;
  backdrop: { fileId: number; url: string } | null;
  socialLinks: {
    discord: string | null;
    telegram: string | null;
    x: string | null;
  };
  // The most a member's file may have, in bytes; null when the site could not be read.
  maxUploadBytes: number | null;
  // Whether the forum list shows the statistics panel; off when the site could not be read.
  forumStatsEnabled: boolean;
  // The analytics tag public pages carry; provider "none" when unset or the site could not be read.
  analytics: z.output<typeof Analytics>;
  // The version of the cookie policy visitors consent to: the backend's own number when `site.get`
  // carries one, the constant of the web app until then.
  cookiePolicyVersion: number;
  // The active accents of the palette in display order: the first is the site's own.
  accents: { id: number; color: string; foreground: string | null }[];
};

// The one place that reads the site's description: "" when the site has none or the answer
// carries anything that is not text.
export function siteDescription(site: object): string {
  const { description } = site as { description?: unknown };
  return typeof description === "string" ? description.trim() : "";
}

// The same for every visitor: asked without the visitor's cookies or address, so the answer can be
// shared. An error thrown out of a cached function fails the prerender, so a failure is answered
// here with the fallback, which is asked for again after five seconds instead of a minute.
async function fetchSite(defaultName: string): Promise<SiteIdentity> {
  "use cache";
  cacheTag("site");
  try {
    const site = await callWith({}, siteGet, {});
    const {
      name,
      logo,
      icon,
      backdrop,
      socialLinks,
      maxUploadBytes,
      forumStatsEnabled,
      analytics,
      palette,
    } = site;
    // Fresh for a minute, so a change in the administration panel shows up without a deploy. The
    // expiry is above five minutes, which keeps the entry part of prerendered output.
    cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
    return {
      name,
      description: siteDescription(site),
      logo,
      icon,
      backdrop,
      socialLinks,
      maxUploadBytes,
      forumStatsEnabled,
      analytics,
      cookiePolicyVersion: policyVersion(site),
      accents: palette.accents.map(({ id, color, foreground }) => ({
        id,
        color,
        foreground,
      })),
    };
  } catch (error) {
    // The expiry stays above five minutes: a shorter entry is left out of the prerender and the
    // build then reports a cache miss for every page.
    cacheLife({ stale: 30, revalidate: 5, expire: 600 });
    // `next build` prerenders without a backend, so nothing is logged during the build.
    if (process.env.NEXT_PHASE !== "phase-production-build")
      console.error("The site could not be read from the API", error);
    return {
      name: defaultName,
      description: "",
      logo: null,
      icon: null,
      backdrop: null,
      socialLinks: { discord: null, telegram: null, x: null },
      maxUploadBytes: null,
      forumStatsEnabled: false,
      analytics: { provider: "none" },
      cookiePolicyVersion: POLICY_VERSION,
      accents: [],
    };
  }
}

// The default name is read here because a cached function cannot read the request's language.
export const getSite = cache(async (): Promise<SiteIdentity> => {
  const t = await getTranslations("layout.site");
  return fetchSite(t("defaultName"));
});
