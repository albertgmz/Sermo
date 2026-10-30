import "server-only";

import { type SocialProvider, siteGet } from "@sermo/core/contracts";
import { cacheLife, cacheTag } from "next/cache";
import { cache } from "react";
import { callWith } from "./transport";

export type SocialSignIn = {
  providers: SocialProvider[];
  googleClientId: string | null;
};

const NONE: SocialSignIn = { providers: [], googleClientId: null };

// The sign-in providers that are on, and Google's public client id for One Tap: the same for every
// visitor, read as `getSite` reads the site (fresh for a minute). None while the site cannot be
// read, so the pages show only the password forms; asked again after five seconds then.
async function fetchSocialSignIn(): Promise<SocialSignIn> {
  "use cache";
  cacheTag("site");
  try {
    const { socialSignIn } = await callWith({}, siteGet, {});
    cacheLife({ stale: 60, revalidate: 60, expire: 3600 });
    return socialSignIn;
  } catch {
    cacheLife({ stale: 30, revalidate: 5, expire: 600 });
    return NONE;
  }
}

export const getSocialSignIn = cache(fetchSocialSignIn);
