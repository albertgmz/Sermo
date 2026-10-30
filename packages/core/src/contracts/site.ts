import * as z from "zod";
import { HOME_TABS } from "../db/schema";
import { defineContract } from "../operation";
import { PaletteColor } from "./appearance";
import { Empty } from "./common";
import { MAX_COOKIE_POLICY_VERSION } from "./consent";
import { ImageReference } from "./images";
import { Analytics, REGISTRATION_FIELDS, SUPPORTED_LANGUAGES, TURNSTILE_FORMS } from "./settings";

/**
 * What every page needs to draw the site before it knows anything about the visitor: the name,
 * the identity pictures and the active colours. It holds nothing private.
 */
export const Site = z
  .object({
    name: z.string(),
    /** The site's description (up to 300 characters); empty when none is set. */
    description: z.string(),
    logo: ImageReference,
    icon: ImageReference,
    backdrop: ImageReference,
    /** The site's accounts on other networks; null where none is set. */
    socialLinks: z.object({
      discord: z.string().nullable(),
      telegram: z.string().nullable(),
      x: z.string().nullable(),
    }),
    /**
     * The size limit, in bytes, of a file a member uploads (the site setting the API enforces
     * for everyone), so an oversized file can be refused before it is sent. Pictures of the
     * site's catalogs keep a fixed 25 MiB whatever this says.
     */
    maxUploadBytes: z.number().int().positive(),
    /** Whether the forum list shows the forum statistics panel (the site setting). */
    forumStatsEnabled: z.boolean(),
    /** Whether the +18 mode is on (the site setting): content marked +18 reaches only adults. */
    adultMode: z.boolean(),
    /** The analytics tag public pages carry (the site setting); provider `none` adds nothing. */
    analytics: Analytics,
    /**
     * The version of the cookie policy visitors answer in the cookie banner. A saved choice of
     * another version counts as none, so raising it (`consent.askAgain`) asks everyone again.
     */
    cookiePolicyVersion: z.number().int().min(1).max(MAX_COOKIE_POLICY_VERSION),
    /**
     * Whether the cookie banner is shown to visitors outside Europe too (the site setting;
     * `consent.banner` tells whether it applies to one visitor).
     */
    cookieBannerOutsideEu: z.boolean(),
    /**
     * Language for guests and members who have not chosen one. The browser's language does not
     * change it; only the language cookie does.
     */
    defaultLanguage: z.enum(SUPPORTED_LANGUAGES),
    /**
     * Cloudflare Turnstile as the guest forms need it: the public site key and the forms the
     * check guards. Null when it is off or not fully set up (a form then needs no token). The
     * secret is never part of it.
     */
    turnstile: z
      .object({ siteKey: z.string(), forms: z.array(z.enum(TURNSTILE_FORMS)) })
      .nullable(),
    /**
     * What the sign-up form needs: whether registration is open, whether a new account waits for
     * staff, the youngest age that may register (0: none; above 0 the form asks for the full
     * date of birth), and the profile fields the form must ask.
     */
    registration: z.object({
      open: z.boolean(),
      approval: z.boolean(),
      minimumAge: z.number().int().min(0),
      fields: z.array(z.enum(REGISTRATION_FIELDS)),
    }),
    palette: z.object({
      accents: z.array(PaletteColor),
      nameColors: z.array(PaletteColor),
      prefixColors: z.array(PaletteColor),
    }),
  })
  .meta({ id: "Site" });

export const siteGet = defineContract({
  name: "site.get",
  summary:
    "The site as every visitor sees it: its name, its logo, icon and backdrop, and the active " +
    "colours of each catalog in display order, the upload size limit and whether the forum " +
    "statistics panel is shown. Open to everyone.",
  kind: "read",
  input: Empty,
  output: Site,
});

export const siteHomeTab = defineContract({
  name: "site.homeTab",
  summary:
    "The tab of the feed page (What's new) the viewer opens on when the address names none: the tab the " +
    "member chose, else the tab of the first of the site's home tab rules (an administrator's " +
    "setting, cheap criteria only, guests included) that the viewer meets, else the site's " +
    "fallback. `following` needs an account, so a guest is never answered it (they get " +
    "`latest`). Open to everyone.",
  kind: "read",
  input: Empty,
  output: z.object({ tab: z.enum(HOME_TABS) }),
});
