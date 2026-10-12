import { insertUser } from "@sermo/core/testing";
import { type Ctx, invalidate } from "../../context";

type ImageKind = "frame" | "profile_cover" | "thread_cover";

let counter = 0;

/**
 * Test fixtures: catalog entries written straight to the tables. Entries made through the
 * catalog operations need an uploaded picture; these stand in for one with a file row.
 */
export function insertCatalogImage(
  ctx: Ctx,
  kind: ImageKind,
  options: { name?: string; active?: boolean; picture?: boolean } = {},
): number {
  const withPicture = options.picture ?? true;
  counter++;
  let fileId: number | null = null;
  if (withPicture) {
    const uploader =
      ctx.sqlite.prepare<{ id: number }, []>("SELECT id FROM users LIMIT 1").get()?.id ??
      insertUser(ctx).id;
    const purpose = { frame: "frame", profile_cover: "cover_preset", thread_cover: "thread_cover" }[
      kind
    ];
    fileId = ctx.sqlite
      .prepare<{ id: number }, [string, number, string, number]>(
        "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at, attached_at) VALUES ('fake', ?1, 1, 'image/png', 'hash', ?2, ?3, 'public', ?4, ?4) RETURNING id",
      )
      .get(`fixture-${counter}`, uploader, purpose, ctx.now())!.id;
  }
  const placement =
    kind === "frame" && withPicture ? [150, -25, -25, 90] : [null, null, null, null];
  const id = ctx.sqlite
    .prepare<{ id: number }, (string | number | null)[]>(
      "INSERT INTO catalog_images (kind, name, file_id, frame_width, frame_left, frame_top, frame_scale, position, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10) RETURNING id",
    )
    .get(
      kind,
      options.name ?? `${kind} ${counter}`,
      fileId,
      ...placement,
      counter,
      options.active === false ? 0 : 1,
      ctx.now(),
    )!.id;
  invalidate(ctx, "appearance");
  return id;
}

/** A palette entry of kind `name` (a name colour) or `accent`. */
export function insertPaletteColor(
  ctx: Ctx,
  options: { kind?: "name" | "accent"; color?: string; active?: boolean } = {},
): number {
  counter++;
  const kind = options.kind ?? "name";
  const id = ctx.sqlite
    .prepare<{ id: number }, (string | number | null)[]>(
      "INSERT INTO palette_colors (kind, name, color, foreground, position, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7) RETURNING id",
    )
    .get(
      kind,
      `${kind} ${counter}`,
      options.color ?? "#336699",
      kind === "accent" ? "#ffffff" : null,
      1000 + counter,
      options.active === false ? 0 : 1,
      ctx.now(),
    )!.id;
  invalidate(ctx, "appearance");
  return id;
}
