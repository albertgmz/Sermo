import type * as z from "zod";
import { type Ctx, cached, prepared } from "../../context";
import type { CatalogImage, PaletteColor } from "../../contracts/appearance";
import type { CATALOG_IMAGE_KINDS, PALETTE_KINDS } from "../../db/schema";
import { iso } from "../../time";
import { publicPicture } from "../storage/url";

export type CatalogImageKind = (typeof CATALOG_IMAGE_KINDS)[number];
export type PaletteKind = (typeof PALETTE_KINDS)[number];
export type CatalogImageValue = z.infer<typeof CatalogImage>;
export type PaletteColorValue = z.infer<typeof PaletteColor>;

export interface CatalogImageRow {
  id: number;
  kind: CatalogImageKind;
  name: string;
  file_id: number | null;
  frame_width: number | null;
  frame_left: number | null;
  frame_top: number | null;
  frame_scale: number | null;
  position: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}
export interface PaletteColorRow {
  id: number;
  kind: PaletteKind;
  name: string;
  color: string;
  foreground: string | null;
  position: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}

/** The most entries one catalog holds. */
export const CATALOG_LIMIT = 500;

export const imageValue = (ctx: Ctx, row: CatalogImageRow): CatalogImageValue => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  image: publicPicture(ctx, row.file_id),
  placement:
    row.frame_width === null ||
    row.frame_left === null ||
    row.frame_top === null ||
    row.frame_scale === null
      ? null
      : {
          width: row.frame_width,
          left: row.frame_left,
          top: row.frame_top,
          scale: row.frame_scale,
        },
  position: row.position,
  isActive: !!row.is_active,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

export const colorValue = (row: PaletteColorRow): PaletteColorValue => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  color: row.color,
  foreground: row.foreground,
  position: row.position,
  isActive: !!row.is_active,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

/** Both catalogs, whole, in display order. Rebuilt when the `appearance` cache version moves. */
interface Catalogs {
  images: Record<CatalogImageKind, CatalogImageValue[]>;
  /** What a visitor without admin.appearance sees: active entries that have a picture. */
  visibleImages: Record<CatalogImageKind, CatalogImageValue[]>;
  imageById: Map<number, CatalogImageValue>;
  colors: Record<PaletteKind, PaletteColorValue[]>;
  activeColors: Record<PaletteKind, PaletteColorValue[]>;
  colorById: Map<number, PaletteColorValue>;
}

function build(ctx: Ctx): Catalogs {
  const catalogs: Catalogs = {
    images: { frame: [], profile_cover: [], thread_cover: [] },
    visibleImages: { frame: [], profile_cover: [], thread_cover: [] },
    imageById: new Map(),
    colors: { accent: [], name: [], prefix: [] },
    activeColors: { accent: [], name: [], prefix: [] },
    colorById: new Map(),
  };
  const images = ctx.sqlite
    .prepare<CatalogImageRow, []>("SELECT * FROM catalog_images ORDER BY position, id")
    .all();
  for (const row of images) {
    const value = imageValue(ctx, row);
    catalogs.images[row.kind].push(value);
    if (value.isActive && value.image) catalogs.visibleImages[row.kind].push(value);
    catalogs.imageById.set(value.id, value);
  }
  const colors = ctx.sqlite
    .prepare<PaletteColorRow, []>("SELECT * FROM palette_colors ORDER BY position, id")
    .all();
  for (const row of colors) {
    const value = colorValue(row);
    catalogs.colors[row.kind].push(value);
    if (value.isActive) catalogs.activeColors[row.kind].push(value);
    catalogs.colorById.set(value.id, value);
  }
  return catalogs;
}

export const catalogs = (ctx: Ctx): Catalogs => cached(ctx, "appearance", () => build(ctx));

/** A catalog picture by id (inactive ones included), or null. Reads the cache. */
export function catalogImageById(ctx: Ctx, id: number): CatalogImageValue | null {
  return catalogs(ctx).imageById.get(id) ?? null;
}

/** A palette colour by id (inactive ones included), or null. Reads the cache. */
export function paletteColorById(ctx: Ctx, id: number): PaletteColorValue | null {
  return catalogs(ctx).colorById.get(id) ?? null;
}

/**
 * "Is this entry in use?", asked before it is deleted. One statement per catalog; every feature
 * that starts to refer to catalog entries (shop items, thread prefixes) adds its own lookup here.
 * Each is `SELECT 1 ... LIMIT 1` on a partial index.
 */
export const inUseSql = {
  frame: "SELECT 1 FROM users WHERE frame_id = ?1 LIMIT 1",
  profile_cover: "SELECT 1 FROM users WHERE cover_preset_id = ?1 LIMIT 1",
  thread_cover: "SELECT 1 FROM threads WHERE cover_id = ?1 LIMIT 1",
  accent: "SELECT 1 FROM users WHERE accent_color_id = ?1 LIMIT 1",
  // A member's own choice, or the colour of a group (a small table).
  name: "SELECT 1 WHERE EXISTS (SELECT 1 FROM users WHERE name_color_id = ?1) OR EXISTS (SELECT 1 FROM groups WHERE name_color_id = ?1)",
  prefix: "SELECT 1 FROM thread_prefixes WHERE color_id = ?1 LIMIT 1",
} as const;

function inUse(ctx: Ctx, sql: string, id: number): boolean {
  return !!prepared(ctx, `appearance.${sql}`, () =>
    ctx.sqlite.prepare<{ 1: number }, [number]>(sql),
  ).get(id);
}

/** Whether anything refers to the picture. Extend here when a new feature refers to pictures. */
export function catalogImageInUse(ctx: Ctx, kind: CatalogImageKind, id: number): boolean {
  return inUse(ctx, inUseSql[kind], id);
}

/** Whether anything refers to the colour. Extend here when a new feature refers to colours. */
export function paletteColorInUse(ctx: Ctx, kind: PaletteKind, id: number): boolean {
  return inUse(ctx, inUseSql[kind], id);
}
