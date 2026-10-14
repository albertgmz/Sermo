import type * as z from "zod";
import { requireAuthenticated } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import {
  catalogImagesCreate,
  catalogImagesDelete,
  catalogImagesList,
  catalogImagesUpdate,
  FramePlacement,
  paletteColorsCreate,
  paletteColorsDelete,
  paletteColorsList,
  paletteColorsUpdate,
} from "../../contracts/appearance";
import { siteGet } from "../../contracts/site";
import { writeTx } from "../../db/tx";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { can, requirePermission } from "../../permissions";
import { attachUploadedFile, releaseFile } from "../images/attach";
import { type FrameOpening, frameGeometry } from "../images/frame-geometry";
import { appendModeratorLog } from "../moderation";
import { readSiteSettings } from "../settings";
import { publicPicture } from "../storage/url";
import {
  CATALOG_LIMIT,
  type CatalogImageKind,
  type CatalogImageRow,
  catalogImageInUse,
  catalogs,
  colorValue,
  imageValue,
  type PaletteColorRow,
  type PaletteKind,
  paletteColorInUse,
} from "./store";
import { wearingOperations } from "./wearing";

export { catalogImageById, paletteColorById } from "./store";

type Placement = z.infer<typeof FramePlacement>;
type Table = "catalog_images" | "palette_colors";

/** The upload purpose of each picture catalog. */
const PURPOSE_OF_KIND: Record<CatalogImageKind, string> = {
  frame: "frame",
  profile_cover: "cover_preset",
  thread_cover: "thread_cover",
};

const unmeasured = () =>
  new ValidationError("The frame's opening could not be measured; give a placement.");

/** The opening measured at upload, with the file's size, turned into a placement. */
function measuredPlacement(ctx: Ctx, fileId: number): Placement {
  const file = ctx.sqlite
    .prepare<{ width: number | null; height: number | null; meta: string | null }, [number]>(
      "SELECT width, height, meta FROM files WHERE id = ?1",
    )
    .get(fileId);
  let opening: FrameOpening | null = null;
  try {
    if (file?.meta) opening = (JSON.parse(file.meta) as { opening?: FrameOpening }).opening ?? null;
  } catch {
    opening = null;
  }
  if (!file?.width || !file.height || !opening) throw unmeasured();
  const placement = FramePlacement.safeParse(frameGeometry(opening, file.width, file.height));
  if (!placement.success) throw unmeasured();
  return placement.data;
}

function requireRoom(ctx: Ctx, table: Table, kind: string) {
  const { n } = ctx.sqlite
    .prepare<{ n: number }, [string]>(`SELECT COUNT(*) AS n FROM ${table} WHERE kind = ?1`)
    .get(kind)!;
  if (n >= CATALOG_LIMIT)
    throw new ConflictError(`A catalog holds at most ${CATALOG_LIMIT} entries.`);
}

function imageRow(ctx: Ctx, id: number): CatalogImageRow {
  const row = ctx.sqlite
    .prepare<CatalogImageRow, [number]>("SELECT * FROM catalog_images WHERE id = ?1")
    .get(id);
  if (!row) throw new NotFoundError();
  return row;
}

function colorRow(ctx: Ctx, id: number): PaletteColorRow {
  const row = ctx.sqlite
    .prepare<PaletteColorRow, [number]>("SELECT * FROM palette_colors WHERE id = ?1")
    .get(id);
  if (!row) throw new NotFoundError();
  return row;
}

type Quad = [number | null, number | null, number | null, number | null];
const placementColumns = (placement: Placement | null): Quad =>
  placement
    ? [placement.width, placement.left, placement.top, placement.scale]
    : [null, null, null, null];

/** An accent has a foreground; the other kinds have none. */
function requireForeground(kind: PaletteKind, foreground: string | undefined) {
  if (kind === "accent" && foreground === undefined)
    throw new ValidationError("An accent needs a foreground colour.");
  if (kind !== "accent" && foreground !== undefined)
    throw new ValidationError("Only an accent has a foreground colour.");
}

export const operations = [
  implement(
    catalogImagesList,
    (ctx, actor, input) => {
      const lists = catalogs(ctx);
      return {
        items: can(ctx, actor, "admin.appearance")
          ? lists.images[input.kind]
          : lists.visibleImages[input.kind],
      };
    },
    { public: "Guests see the site's catalogs; inactive entries need admin.appearance." },
  ),

  implement(catalogImagesCreate, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.appearance");
    const user = requireAuthenticated(actor);
    if (input.kind !== "frame" && input.placement !== undefined)
      throw new ValidationError("Only a frame has a placement.");
    return writeTx(ctx, () => {
      requireRoom(ctx, "catalog_images", input.kind);
      attachUploadedFile(ctx, user.userId, input.fileId, PURPOSE_OF_KIND[input.kind]);
      const placement =
        input.kind === "frame" ? (input.placement ?? measuredPlacement(ctx, input.fileId)) : null;
      const row = ctx.sqlite
        .prepare<CatalogImageRow, (string | number | null)[]>(
          "INSERT INTO catalog_images (kind, name, file_id, frame_width, frame_left, frame_top, frame_scale, position, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10) RETURNING *",
        )
        .get(
          input.kind,
          input.name,
          input.fileId,
          ...placementColumns(placement),
          input.position,
          input.isActive ? 1 : 0,
          ctx.now(),
        )!;
      invalidate(ctx, "appearance");
      appendModeratorLog(ctx, actor, "appearance.image.create", "catalog_image", row.id, "", {
        kind: input.kind,
        fileId: input.fileId,
      });
      return imageValue(ctx, row);
    });
  }),

  implement(catalogImagesUpdate, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.appearance");
    const user = requireAuthenticated(actor);
    return writeTx(ctx, () => {
      const row = imageRow(ctx, input.imageId);
      if (row.kind !== "frame" && input.placement != null)
        throw new ValidationError("Only a frame has a placement.");
      let fileId = row.file_id;
      if (input.fileId !== undefined) {
        attachUploadedFile(ctx, user.userId, input.fileId, PURPOSE_OF_KIND[row.kind]);
        fileId = input.fileId;
      }
      let placement = imageValue(ctx, row).placement;
      if (input.placement) placement = input.placement;
      else if (row.kind === "frame" && (input.placement === null || input.fileId !== undefined)) {
        if (fileId === null) throw unmeasured();
        placement = measuredPlacement(ctx, fileId);
      }
      const isActive = input.isActive ?? !!row.is_active;
      if (isActive && fileId === null)
        throw new ConflictError("An entry without a picture cannot be active.");
      ctx.sqlite
        .prepare<unknown, (string | number | null)[]>(
          "UPDATE catalog_images SET name = ?1, file_id = ?2, frame_width = ?3, frame_left = ?4, frame_top = ?5, frame_scale = ?6, position = ?7, is_active = ?8, updated_at = ?9 WHERE id = ?10",
        )
        .run(
          input.name ?? row.name,
          fileId,
          ...placementColumns(placement),
          input.position ?? row.position,
          isActive ? 1 : 0,
          ctx.now(),
          row.id,
        );
      if (input.fileId !== undefined && row.file_id !== null) releaseFile(ctx, row.file_id);
      invalidate(ctx, "appearance");
      appendModeratorLog(ctx, actor, "appearance.image.update", "catalog_image", row.id, "", {
        changedKeys: Object.keys(input).filter((key) => key !== "imageId"),
      });
      return imageValue(ctx, imageRow(ctx, row.id));
    });
  }),

  implement(catalogImagesDelete, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.appearance");
    return writeTx(ctx, () => {
      const row = imageRow(ctx, input.imageId);
      const deactivated = catalogImageInUse(ctx, row.kind, row.id);
      if (deactivated)
        ctx.sqlite
          .prepare("UPDATE catalog_images SET is_active = 0, updated_at = ?1 WHERE id = ?2")
          .run(ctx.now(), row.id);
      else {
        ctx.sqlite.prepare("DELETE FROM catalog_images WHERE id = ?1").run(row.id);
        if (row.file_id !== null) releaseFile(ctx, row.file_id);
      }
      invalidate(ctx, "appearance");
      appendModeratorLog(ctx, actor, "appearance.image.delete", "catalog_image", row.id, "", {
        kind: row.kind,
        deactivated,
      });
      return { ok: true as const, deactivated };
    });
  }),

  implement(
    paletteColorsList,
    (ctx, actor, input) => {
      const lists = catalogs(ctx);
      return {
        items: can(ctx, actor, "admin.appearance")
          ? lists.colors[input.kind]
          : lists.activeColors[input.kind],
      };
    },
    { public: "Guests see the site's palette; inactive colours need admin.appearance." },
  ),

  implement(paletteColorsCreate, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.appearance");
    requireForeground(input.kind, input.foreground);
    return writeTx(ctx, () => {
      requireRoom(ctx, "palette_colors", input.kind);
      const row = ctx.sqlite
        .prepare<PaletteColorRow, (string | number | null)[]>(
          "INSERT INTO palette_colors (kind, name, color, foreground, position, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7) RETURNING *",
        )
        .get(
          input.kind,
          input.name,
          input.color,
          input.foreground ?? null,
          input.position,
          input.isActive ? 1 : 0,
          ctx.now(),
        )!;
      invalidate(ctx, "appearance");
      appendModeratorLog(ctx, actor, "appearance.color.create", "palette_color", row.id, "", {
        kind: row.kind,
      });
      return colorValue(row);
    });
  }),

  implement(paletteColorsUpdate, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.appearance");
    return writeTx(ctx, () => {
      const row = colorRow(ctx, input.colorId);
      const foreground = input.foreground ?? row.foreground;
      requireForeground(row.kind, foreground ?? undefined);
      ctx.sqlite
        .prepare<unknown, (string | number | null)[]>(
          "UPDATE palette_colors SET name = ?1, color = ?2, foreground = ?3, position = ?4, is_active = ?5, updated_at = ?6 WHERE id = ?7",
        )
        .run(
          input.name ?? row.name,
          input.color ?? row.color,
          foreground,
          input.position ?? row.position,
          (input.isActive ?? !!row.is_active) ? 1 : 0,
          ctx.now(),
          row.id,
        );
      invalidate(ctx, "appearance");
      appendModeratorLog(ctx, actor, "appearance.color.update", "palette_color", row.id, "", {
        changedKeys: Object.keys(input).filter((key) => key !== "colorId"),
      });
      return colorValue(colorRow(ctx, row.id));
    });
  }),

  implement(paletteColorsDelete, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.appearance");
    return writeTx(ctx, () => {
      const row = colorRow(ctx, input.colorId);
      const deactivated = paletteColorInUse(ctx, row.kind, row.id);
      if (deactivated)
        ctx.sqlite
          .prepare("UPDATE palette_colors SET is_active = 0, updated_at = ?1 WHERE id = ?2")
          .run(ctx.now(), row.id);
      else ctx.sqlite.prepare("DELETE FROM palette_colors WHERE id = ?1").run(row.id);
      invalidate(ctx, "appearance");
      appendModeratorLog(ctx, actor, "appearance.color.delete", "palette_color", row.id, "", {
        kind: row.kind,
        deactivated,
      });
      return { ok: true as const, deactivated };
    });
  }),

  implement(
    siteGet,
    (ctx) => {
      const settings = readSiteSettings(ctx);
      const lists = catalogs(ctx);
      return {
        name: settings.siteName,
        description: settings.siteDescription,
        logo: publicPicture(ctx, settings.logoFileId),
        icon: publicPicture(ctx, settings.iconFileId),
        backdrop: publicPicture(ctx, settings.backdropFileId),
        socialLinks: settings.socialLinks,
        maxUploadBytes: settings.maxUploadBytes,
        forumStatsEnabled: settings.forumStatsEnabled,
        defaultLanguage: settings.defaultLanguage,
        palette: {
          accents: lists.activeColors.accent,
          nameColors: lists.activeColors.name,
          prefixColors: lists.activeColors.prefix,
        },
      };
    },
    { public: "The site's name, pictures and palette are what every visitor sees." },
  ),

  ...wearingOperations,
];
