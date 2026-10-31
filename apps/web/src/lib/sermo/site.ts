import "server-only";

import {
  type Analytics,
  type RegistrationField,
  siteGet,
  type TurnstileForm,
} from "@sermo/core/contracts";
import { cacheLife, cacheTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import type * as z from "zod";
import { POLICY_VERSION } from "@/lib/consent/inventory";
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
  // The analytics tag public pages carry; provider "none" when unset or the site could not be read.
  analytics: z.output<typeof Analytics>;
  // Cloudflare Turnstile on the guest forms: the public site key and the forms it guards; null
  // when it is off, not fully set up, or the site could not be read.
  turnstile: { siteKey: string; forms: TurnstileForm[] } | null;
  // What the sign-up form asks: whether registration is open, whether new accounts wait for
  // staff, the youngest age that may register (0: none) and the profile fields to ask. Open and
  // asking nothing while the site could not be read: the backend decides at sign-up.
  registration: {
    open: boolean;
    approval: boolean;
    minimumAge: number;
    fields: RegistrationField[];
  };
  // Whether a member must confirm their email address (the site asks it and sends mail). On
  // while the site cannot be read, as it is by default.
  confirmEmail: boolean;
  // The version of the cookie policy visitors consent to (an administrator raises it to ask
  // everyone again); the first version while the site cannot be read.
  cookiePolicyVersion: number;
  // The cookie banner is shown to visitors outside Europe too.
  cookieBannerOutsideEu: boolean;
  // The active accents of the palette in display order: the first is the site's own.
  accents: { id: number; color: string; foreground: string | null }[];
  // The +18 mode: content marked +18 reaches only adults, carries the +18 badge and can be marked.
  // Off while the site cannot be read: the backend still hides what it must.
  adultMode: boolean;
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
      analytics,
      cookiePolicyVersion,
      cookieBannerOutsideEu,
      turnstile,
      registration,
      confirmEmail,
      palette,
      adultMode,
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
      analytics,
      cookiePolicyVersion,
      cookieBannerOutsideEu,
      turnstile,
      registration,
      confirmEmail,
      accents: palette.accents.map(({ id, color, foreground }) => ({
        id,
        color,
        foreground,
      })),
      adultMode,
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
      analytics: { provider: "none" },
      turnstile: null,
      registration: { open: true, approval: false, minimumAge: 0, fields: [] },
      confirmEmail: true,
      cookiePolicyVersion: POLICY_VERSION,
      cookieBannerOutsideEu: true,
      accents: [],
      adultMode: false,
    };
  }
}

// The default name is read here because a cached function cannot read the request's language.
export const getSite = cache(async (): Promise<SiteIdentity> => {
  const t = await getTranslations("layout.site");
  return fetchSite(t("defaultName"));
});
