import * as z from "zod";
import { defineContract } from "../operation";
import { PaletteColor } from "./appearance";
import { Empty } from "./common";
import { ImageReference } from "./images";

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
