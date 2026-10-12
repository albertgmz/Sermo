import * as z from "zod";
import { CATALOG_IMAGE_KINDS, PALETTE_KINDS } from "../db/schema";
import { defineContract } from "../operation";
import { Id, Timestamp } from "./common";
import { ImageReference } from "./images";

/*
 * What members can look like is data: the pictures (avatar frames, profile covers, thread
 * covers) and the colours (accents, name colours, prefix colours) are catalogs an administrator
 * fills. A catalog holds at most 500 entries of one kind, so its lists are not paginated.
 *
 * A picture is uploaded first (POST /api/v1/files?purpose=..., the purpose of its kind: `frame`
 * for a frame, `cover_preset` for a profile cover, `thread_cover` for a thread cover) and then
 * named here. Deleting an entry that members, threads or shop items still use deactivates it
 * instead and keeps its picture: nobody loses what they have, and nobody new can pick it.
 */

export const CatalogImageKind = z.enum(CATALOG_IMAGE_KINDS);
export const PaletteKind = z.enum(PALETTE_KINDS);

export const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb color.")
  .transform((value) => value.toLowerCase());

/**
 * Where a frame sits around the avatar box, in percent of the box: the frame is `width` wide
 * with its top-left corner at (`left`, `top`), and the picture is scaled to `scale` about the
 * centre of the box so it fills the frame's opening.
 */
export const FramePlacement = z
  .object({
    width: z.number().min(50).max(400),
    left: z.number().min(-200).max(100),
    top: z.number().min(-200).max(100),
    scale: z.number().min(40).max(100),
  })
  .meta({ id: "FramePlacement" });

export const CatalogImage = z
  .object({
    id: Id,
    kind: CatalogImageKind,
    name: z.string(),
    /** Null while the entry waits for its picture; such an entry is never active. */
    image: ImageReference,
    /** Frames only; null for the other kinds. */
    placement: FramePlacement.nullable(),
    position: z.number().int(),
    isActive: z.boolean(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "CatalogImage" });

export const PaletteColor = z
  .object({
    id: Id,
    kind: PaletteKind,
    name: z.string(),
    /** #rrggbb, lower case. */
    color: z.string(),
    /** Accents only: the colour of text drawn on the accent. Null for the other kinds. */
    foreground: z.string().nullable(),
    position: z.number().int(),
    isActive: z.boolean(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "PaletteColor" });

const Name = z.string().trim().min(1).max(60);
const Position = z.number().int().min(0).max(1_000_000);

// Pictures -----------------------------------------------------------------------------------

export const catalogImagesList = defineContract({
  name: "catalogImages.list",
  summary:
    "One picture catalog in display order (position, then id). Open to everyone; inactive " +
    "entries and entries without a picture only with admin.appearance.",
  kind: "read",
  input: z.object({ kind: CatalogImageKind }),
  output: z.object({ items: z.array(CatalogImage) }),
});

export const catalogImagesCreate = defineContract({
  name: "catalogImages.create",
  summary:
    "Add a picture to a catalog from an unattached file the actor uploaded with the purpose of " +
    "the kind. A frame takes its placement from the opening measured at upload unless " +
    "`placement` is given; a frame whose opening could not be measured needs one. Requires " +
    "admin.appearance.",
  kind: "write",
  input: z.object({
    kind: CatalogImageKind,
    name: Name,
    fileId: Id,
    placement: FramePlacement.optional(),
    position: Position.default(0),
    isActive: z.boolean().default(true),
  }),
  output: CatalogImage,
});

export const catalogImagesUpdate = defineContract({
  name: "catalogImages.update",
  summary:
    "Change a catalog picture. A new `fileId` replaces the picture (the old file is deleted; a " +
    "frame is measured again unless `placement` is given). `placement: null` on a frame goes " +
    "back to the measured placement. An entry without a picture cannot be made active. " +
    "Requires admin.appearance.",
  kind: "write",
  input: z.object({
    imageId: Id,
    name: Name.optional(),
    fileId: Id.optional(),
    placement: FramePlacement.nullable().optional(),
    position: Position.optional(),
    isActive: z.boolean().optional(),
  }),
  output: CatalogImage,
});

export const catalogImagesDelete = defineContract({
  name: "catalogImages.delete",
  summary:
    "Remove a catalog picture. While a member, a thread or a shop item uses it, it is " +
    "deactivated instead and keeps its file (`deactivated: true`); otherwise the entry and its " +
    "file are deleted. Requires admin.appearance.",
  kind: "write",
  input: z.object({ imageId: Id }),
  output: z.object({ ok: z.literal(true), deactivated: z.boolean() }),
});

// Colours ------------------------------------------------------------------------------------

export const paletteColorsList = defineContract({
  name: "paletteColors.list",
  summary:
    "One colour catalog in display order (position, then id). Open to everyone; inactive " +
    "colours only with admin.appearance.",
  kind: "read",
  input: z.object({ kind: PaletteKind }),
  output: z.object({ items: z.array(PaletteColor) }),
});

export const paletteColorsCreate = defineContract({
  name: "paletteColors.create",
  summary:
    "Add a colour to a catalog. An accent needs a `foreground`; the other kinds take none. " +
    "Requires admin.appearance.",
  kind: "write",
  input: z.object({
    kind: PaletteKind,
    name: Name,
    color: HexColor,
    foreground: HexColor.optional(),
    position: Position.default(0),
    isActive: z.boolean().default(true),
  }),
  output: PaletteColor,
});

export const paletteColorsUpdate = defineContract({
  name: "paletteColors.update",
  summary:
    "Change a catalog colour. Everything that uses it shows the new value at once. Requires " +
    "admin.appearance.",
  kind: "write",
  input: z.object({
    colorId: Id,
    name: Name.optional(),
    color: HexColor.optional(),
    foreground: HexColor.optional(),
    position: Position.optional(),
    isActive: z.boolean().optional(),
  }),
  output: PaletteColor,
});

export const paletteColorsDelete = defineContract({
  name: "paletteColors.delete",
  summary:
    "Remove a catalog colour. While a member, a shop item or a thread prefix uses it, it is " +
    "deactivated instead (`deactivated: true`). Requires admin.appearance.",
  kind: "write",
  input: z.object({ colorId: Id }),
  output: z.object({ ok: z.literal(true), deactivated: z.boolean() }),
});
