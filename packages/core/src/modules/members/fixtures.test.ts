import { type Ctx, invalidate } from "../../context";
import { execute, getOperation } from "../../index";
import { createTestContext, insertUser, userActor } from "../../testing";

/** A database with a few members and helpers to set up what a card shows. Tests only. */
export function world() {
  const ctx = createTestContext();
  const run = (sql: string, ...params: (string | number | null)[]) =>
    ctx.sqlite.prepare<{ id: number }, (string | number | null)[]>(sql).get(...params);
  const admin = insertUser(ctx, { groupId: 4 });
  const moderator = insertUser(ctx, { groupId: 3 });
  const member = insertUser(ctx);
  const call = (
    name: string,
    actor: object,
    input: object,
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
  ) => execute(ctx, getOperation(name), actor as never, input) as Promise<any>;
  return {
    ctx,
    admin,
    moderator,
    member,
    adminActor: userActor(admin),
    moderatorActor: userActor(moderator),
    memberActor: userActor(member),
    call,
    user: (fields: { groupId?: number; username?: string } = {}) => insertUser(ctx, fields),
    set: (userId: number, columns: Record<string, string | number | null>) => {
      const names = Object.keys(columns);
      ctx.sqlite
        .prepare(
          `UPDATE users SET ${names.map((name, i) => `${name} = ?${i + 2}`).join(", ")} WHERE id = ?1`,
        )
        .run(userId, ...names.map((name) => columns[name]!));
    },
    file: (
      uploader: number,
      purpose: string,
      options: { parent?: number; variant?: string } = {},
    ) =>
      run(
        "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, parent_file_id, variant, created_at) VALUES ('local', lower(hex(randomblob(8))), 1, 'image/webp', 'x', ?1, ?2, ?3, ?4, 0) RETURNING id",
        uploader,
        purpose,
        options.parent ?? null,
        options.variant ?? null,
      )!.id,
    color: (kind: "name" | "accent" | "prefix", hex: string, active = true) => {
      const id = run(
        "INSERT INTO palette_colors (kind, name, color, position, is_active, created_at, updated_at) VALUES (?1, ?2, ?2, 0, ?3, 0, 0) RETURNING id",
        kind,
        hex,
        Number(active),
      )!.id;
      invalidate(ctx, "appearance");
      return id;
    },
    image: (
      kind: "frame" | "profile_cover",
      fileId: number | null,
      options: { placement?: boolean; active?: boolean } = {},
    ) => {
      const placed = options.placement ?? kind === "frame";
      const id = run(
        "INSERT INTO catalog_images (kind, name, file_id, frame_width, frame_left, frame_top, frame_scale, position, is_active, created_at, updated_at) VALUES (?1, 'x', ?2, ?3, ?4, ?5, ?6, 0, ?7, 0, 0) RETURNING id",
        kind,
        fileId,
        placed ? 120 : null,
        placed ? -10 : null,
        placed ? -10 : null,
        placed ? 80 : null,
        Number(options.active ?? true),
      )!.id;
      invalidate(ctx, "appearance");
      return id;
    },
    group: (fields: {
      title: string;
      rank: number;
      userTitle?: string;
      badge?: string;
      nameColorId?: number | null;
    }) =>
      run(
        "INSERT INTO groups (title, rank, user_title, badge, name_color_id) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id",
        fields.title,
        fields.rank,
        fields.userTitle ?? "",
        fields.badge ?? "",
        fields.nameColorId ?? null,
      )!.id,
    award: (fields: {
      name: string;
      tier: string;
      xp: number;
      stackable?: boolean;
      active?: boolean;
    }) =>
      run(
        "INSERT INTO awards (name, tier, xp, is_stackable, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 0, 0) RETURNING id",
        fields.name,
        fields.tier,
        fields.xp,
        Number(fields.stackable ?? false),
        Number(fields.active ?? true),
      )!.id,
    hold: (userId: number, awardId: number, count = 1) =>
      ctx.sqlite
        .prepare("INSERT INTO member_award_totals (user_id, award_id, count) VALUES (?1, ?2, ?3)")
        .run(userId, awardId, count),
  };
}
export type World = ReturnType<typeof world>;

export function bulk(ctx: Ctx, count: number, groupId = 2): number[] {
  return Array.from({ length: count }, () => insertUser(ctx, { groupId }).id);
}
