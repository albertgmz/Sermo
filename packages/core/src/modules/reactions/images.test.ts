import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import sharp from "sharp";
import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { createStorage, localDriver } from "../storage";
import { reactionTypesCreateOp, reactionTypesListOp, reactionTypesUpdateOp } from "./index";

function fixture() {
  const ctx = createTestContext();
  const admin = insertUser(ctx, { groupId: 4 });
  const mod = insertUser(ctx, { groupId: 3 });
  const member = insertUser(ctx);
  return { ctx, admin, mod, member, actor: userActor(admin) };
}

/** An unattached picture `uploader` sent, as the storage module leaves it. */
function upload(
  ctx: Ctx,
  uploader: number,
  options: { width?: number; height?: number; purpose?: string; visibility?: string } = {},
) {
  return ctx.sqlite
    .prepare<{ id: number }, [number, string, string, number, number]>(
      "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, width, height, uploader_id, purpose, visibility, created_at) VALUES ('fake', lower(hex(randomblob(8))), 1, 'image/webp', 'h', ?4, ?5, ?1, ?2, ?3, 0) RETURNING id",
    )
    .get(
      uploader,
      options.purpose ?? "reaction_image",
      options.visibility ?? "unattached",
      options.width ?? 64,
      options.height ?? 32,
    )!.id;
}

const fileState = (ctx: Ctx, id: number) =>
  ctx.sqlite
    .prepare<{ visibility: string }, [number]>("SELECT visibility FROM files WHERE id = ?1")
    .get(id)!.visibility;
const deletionQueued = (ctx: Ctx, id: number) =>
  ctx.sqlite
    .prepare<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM jobs WHERE unique_key = ?1")
    .get(`storage.deletePermanent.${id}`)!.n === 1;

const base = { title: "Spark", emoji: "S" };
const listed = async (f: ReturnType<typeof fixture>, id: number) =>
  (await execute(f.ctx, reactionTypesListOp, GUEST, {})).items.find((item) => item.id === id);

describe("reaction type pictures", () => {
  test("a type without a picture has no image and no frames", async () => {
    const f = fixture();
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, base);
    expect(type.image).toBeNull();
    expect(type.frames).toBeNull();
    const items = (await execute(f.ctx, reactionTypesListOp, GUEST, {})).items;
    expect(items.every((item) => item.image === null && item.frames === null)).toBe(true);
  });

  test("a plain picture is attached and listed", async () => {
    const f = fixture();
    const fileId = upload(f.ctx, f.admin.id);
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, { ...base, fileId });
    expect(type.image).toEqual({ fileId, url: `/api/v1/files/${fileId}` });
    expect(type.frames).toBeNull();
    expect(fileState(f.ctx, fileId)).toBe("public");
    expect(await listed(f, type.id)).toEqual(type);
  });

  test("a sprite sheet reports its frame size, count and columns", async () => {
    const f = fixture();
    const fileId = upload(f.ctx, f.admin.id, { width: 96, height: 64 });
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, {
      ...base,
      fileId,
      frameWidth: 32,
      frameHeight: 32,
      frameCount: 5,
    });
    expect(type.frames).toEqual({ width: 32, height: 32, count: 5, columns: 3 });
    expect((await listed(f, type.id))?.frames).toEqual(type.frames);
  });

  test("a frame size alone keeps one frame, cut from the first cell", async () => {
    const f = fixture();
    const fileId = upload(f.ctx, f.admin.id, { width: 64, height: 32 });
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, {
      ...base,
      fileId,
      frameWidth: 32,
      frameHeight: 32,
    });
    expect(type.frames).toEqual({ width: 32, height: 32, count: 1, columns: 2 });
  });

  test("invalid frame geometry is refused and leaves the file unattached", async () => {
    const f = fixture();
    const fileId = upload(f.ctx, f.admin.id, { width: 96, height: 64 });
    const attempts = [
      { frameWidth: 40, frameHeight: 32, frameCount: 2 },
      { frameWidth: 32, frameHeight: 30, frameCount: 2 },
      { frameWidth: 32, frameHeight: 32, frameCount: 7 },
      { frameWidth: 32, frameCount: 2 },
      { frameHeight: 32, frameCount: 2 },
      { frameCount: 2 },
      { frameWidth: 128, frameHeight: 32, frameCount: 1 },
    ];
    for (const attempt of attempts)
      await expect(
        execute(f.ctx, reactionTypesCreateOp, f.actor, { ...base, fileId, ...attempt }),
      ).rejects.toBeInstanceOf(ValidationError);
    expect(fileState(f.ctx, fileId)).toBe("unattached");
    // Frames without a picture.
    await expect(
      execute(f.ctx, reactionTypesCreateOp, f.actor, { ...base, frameWidth: 32, frameHeight: 32 }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      execute(f.ctx, reactionTypesCreateOp, f.actor, { ...base, frameCount: 3 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("the frame count has an upper bound", async () => {
    const f = fixture();
    const fileId = upload(f.ctx, f.admin.id, { width: 1024, height: 16 });
    await expect(
      execute(f.ctx, reactionTypesCreateOp, f.actor, {
        ...base,
        fileId,
        frameWidth: 8,
        frameHeight: 16,
        frameCount: 65,
      }),
    ).rejects.toThrow();
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, {
      ...base,
      fileId,
      frameWidth: 16,
      frameHeight: 16,
      frameCount: 64,
    });
    expect(type.frames?.count).toBe(64);
  });

  test("files of another purpose, another uploader or already attached are refused", async () => {
    const f = fixture();
    const wrongPurpose = upload(f.ctx, f.admin.id, { purpose: "award_image" });
    const someoneElses = upload(f.ctx, f.member.id);
    const taken = upload(f.ctx, f.admin.id, { visibility: "public" });
    for (const fileId of [wrongPurpose, someoneElses, taken, 99999])
      await expect(
        execute(f.ctx, reactionTypesCreateOp, f.actor, { ...base, fileId }),
      ).rejects.toBeInstanceOf(NotFoundError);
    const own = upload(f.ctx, f.admin.id);
    await execute(f.ctx, reactionTypesCreateOp, f.actor, { ...base, fileId: own });
    // The same file cannot back a second type.
    await expect(
      execute(f.ctx, reactionTypesCreateOp, f.actor, { ...base, fileId: own }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("update replaces the picture and queues the old file for deletion", async () => {
    const f = fixture();
    const first = upload(f.ctx, f.admin.id);
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, { ...base, fileId: first });
    const second = upload(f.ctx, f.admin.id, { width: 32, height: 32 });
    const updated = await execute(f.ctx, reactionTypesUpdateOp, f.actor, {
      reactionTypeId: type.id,
      fileId: second,
    });
    expect(updated.image?.fileId).toBe(second);
    expect(fileState(f.ctx, second)).toBe("public");
    expect(deletionQueued(f.ctx, first)).toBe(true);
    expect(deletionQueued(f.ctx, second)).toBe(false);
  });

  test("update without fileId keeps the picture and the frames", async () => {
    const f = fixture();
    const fileId = upload(f.ctx, f.admin.id, { width: 96, height: 32 });
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, {
      ...base,
      fileId,
      frameWidth: 32,
      frameHeight: 32,
      frameCount: 3,
    });
    const updated = await execute(f.ctx, reactionTypesUpdateOp, f.actor, {
      reactionTypeId: type.id,
      title: "Renamed",
    });
    expect(updated.image).toEqual(type.image);
    expect(updated.frames).toEqual(type.frames);
    // Sending the file already attached to this type is not a replacement.
    const same = await execute(f.ctx, reactionTypesUpdateOp, f.actor, {
      reactionTypeId: type.id,
      fileId,
    });
    expect(same.image?.fileId).toBe(fileId);
    expect(deletionQueued(f.ctx, fileId)).toBe(false);
  });

  test("update can change the frames and go back to the whole picture", async () => {
    const f = fixture();
    const fileId = upload(f.ctx, f.admin.id, { width: 96, height: 32 });
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, { ...base, fileId });
    const cut = await execute(f.ctx, reactionTypesUpdateOp, f.actor, {
      reactionTypeId: type.id,
      frameWidth: 48,
      frameHeight: 32,
      frameCount: 2,
    });
    expect(cut.frames).toEqual({ width: 48, height: 32, count: 2, columns: 2 });
    await expect(
      execute(f.ctx, reactionTypesUpdateOp, f.actor, { reactionTypeId: type.id, frameCount: 9 }),
    ).rejects.toBeInstanceOf(ValidationError);
    const whole = await execute(f.ctx, reactionTypesUpdateOp, f.actor, {
      reactionTypeId: type.id,
      frameWidth: null,
      frameHeight: null,
      frameCount: 1,
    });
    expect(whole.frames).toBeNull();
    expect(whole.image?.fileId).toBe(fileId);
  });

  test("a replacement that does not fit the old frames is refused whole", async () => {
    const f = fixture();
    const fileId = upload(f.ctx, f.admin.id, { width: 96, height: 32 });
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, {
      ...base,
      fileId,
      frameWidth: 32,
      frameHeight: 32,
      frameCount: 3,
    });
    const small = upload(f.ctx, f.admin.id, { width: 32, height: 32 });
    await expect(
      execute(f.ctx, reactionTypesUpdateOp, f.actor, { reactionTypeId: type.id, fileId: small }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fileState(f.ctx, small)).toBe("unattached");
    expect(deletionQueued(f.ctx, fileId)).toBe(false);
    const fitted = await execute(f.ctx, reactionTypesUpdateOp, f.actor, {
      reactionTypeId: type.id,
      fileId: small,
      frameCount: 1,
    });
    expect(fitted.frames).toEqual({ width: 32, height: 32, count: 1, columns: 1 });
  });

  test("fileId null removes the picture and its frames and queues the file", async () => {
    const f = fixture();
    const fileId = upload(f.ctx, f.admin.id, { width: 96, height: 32 });
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, {
      ...base,
      fileId,
      frameWidth: 32,
      frameHeight: 32,
      frameCount: 3,
    });
    const removed = await execute(f.ctx, reactionTypesUpdateOp, f.actor, {
      reactionTypeId: type.id,
      fileId: null,
    });
    expect(removed.image).toBeNull();
    expect(removed.frames).toBeNull();
    expect(deletionQueued(f.ctx, fileId)).toBe(true);
    expect((await listed(f, type.id))?.image).toBeNull();
  });

  test("the list is refreshed after a picture changes", async () => {
    const f = fixture();
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, base);
    expect((await listed(f, type.id))?.image).toBeNull();
    const fileId = upload(f.ctx, f.admin.id);
    await execute(f.ctx, reactionTypesUpdateOp, f.actor, { reactionTypeId: type.id, fileId });
    expect((await listed(f, type.id))?.image?.fileId).toBe(fileId);
  });

  test("a missing type is not found and its file stays unattached", async () => {
    const f = fixture();
    const fileId = upload(f.ctx, f.admin.id);
    await expect(
      execute(f.ctx, reactionTypesUpdateOp, f.actor, { reactionTypeId: 99999, fileId }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(fileState(f.ctx, fileId)).toBe("unattached");
  });

  test("only holders of admin.reactionTypes may set a picture", async () => {
    const f = fixture();
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, base);
    for (const [who, error] of [
      [GUEST, UnauthenticatedError],
      [userActor(f.member), ForbiddenError],
      [userActor(f.mod), ForbiddenError],
    ] as const) {
      const fileId = upload(f.ctx, f.mod.id);
      await expect(
        execute(f.ctx, reactionTypesCreateOp, who, { ...base, fileId }),
      ).rejects.toBeInstanceOf(error);
      await expect(
        execute(f.ctx, reactionTypesUpdateOp, who, { reactionTypeId: type.id, fileId }),
      ).rejects.toBeInstanceOf(error);
      expect(fileState(f.ctx, fileId)).toBe("unattached");
    }
  });

  test("a member holding the custom permission may set a picture", async () => {
    const f = fixture();
    const groupId = f.ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Reaction managers', 10) RETURNING id",
      )
      .get()!.id;
    f.ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(f.member.id, groupId);
    f.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = 'admin.reactionTypes'), 0, ?1, 0, 1)",
      )
      .run(groupId);
    f.ctx.sqlite
      .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
      .run();
    const fileId = upload(f.ctx, f.member.id);
    const type = await execute(f.ctx, reactionTypesCreateOp, userActor(f.member), {
      ...base,
      fileId,
    });
    expect(type.image?.fileId).toBe(fileId);
  });

  test("clearing only the frame size goes back to the whole picture", async () => {
    const f = fixture();
    const fileId = upload(f.ctx, f.admin.id, { width: 96, height: 32 });
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, {
      ...base,
      fileId,
      frameWidth: 32,
      frameHeight: 32,
      frameCount: 3,
    });
    const whole = await execute(f.ctx, reactionTypesUpdateOp, f.actor, {
      reactionTypeId: type.id,
      frameWidth: null,
      frameHeight: null,
    });
    expect(whole.frames).toBeNull();
    expect(whole.image?.fileId).toBe(fileId);
    // A count above one sent with the cleared size is still refused.
    await expect(
      execute(f.ctx, reactionTypesUpdateOp, f.actor, {
        reactionTypeId: type.id,
        frameWidth: null,
        frameHeight: null,
        frameCount: 2,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("frames on a type without a picture are refused on update, as on create", async () => {
    const f = fixture();
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, base);
    await expect(
      execute(f.ctx, reactionTypesUpdateOp, f.actor, {
        reactionTypeId: type.id,
        frameWidth: 32,
        frameHeight: 32,
        frameCount: 4,
      }),
    ).rejects.toThrow("Frames need a picture.");
    await expect(
      execute(f.ctx, reactionTypesUpdateOp, f.actor, { reactionTypeId: type.id, frameCount: 2 }),
    ).rejects.toThrow("Frames need a picture.");
    // The same update may bring the picture.
    const fileId = upload(f.ctx, f.admin.id, { width: 64, height: 32 });
    const updated = await execute(f.ctx, reactionTypesUpdateOp, f.actor, {
      reactionTypeId: type.id,
      fileId,
      frameWidth: 32,
      frameHeight: 32,
      frameCount: 2,
    });
    expect(updated.frames?.count).toBe(2);
    // Resetting the frame fields of a type without a picture is fine (the panel's form does).
    const bare = await execute(f.ctx, reactionTypesCreateOp, f.actor, base);
    await execute(f.ctx, reactionTypesUpdateOp, f.actor, {
      reactionTypeId: bare.id,
      frameWidth: null,
      frameHeight: null,
      frameCount: 1,
    });
  });

  test("the public list degrades when the file of a picture is gone", async () => {
    const f = fixture();
    const fileId = upload(f.ctx, f.admin.id, { width: 96, height: 32 });
    const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, {
      ...base,
      fileId,
      frameWidth: 32,
      frameHeight: 32,
      frameCount: 3,
    });
    const other = await execute(f.ctx, reactionTypesCreateOp, f.actor, { ...base, title: "Other" });
    f.ctx.sqlite.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?1").run(fileId);
    f.ctx.sqlite
      .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'reaction_types'")
      .run();
    const items = (await execute(f.ctx, reactionTypesListOp, GUEST, {})).items;
    const degraded = items.find((item) => item.id === type.id);
    expect(degraded?.image).toBeNull();
    expect(degraded?.frames).toBeNull();
    expect(degraded?.emoji).toBe("S");
    expect(items.some((item) => item.id === other.id)).toBe(true);
  });
});

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

test("an uploaded sprite sheet backs a type and is served to a guest once attached", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sermo-reaction-files-"));
  dirs.push(dir);
  const f = fixture();
  const storage = createStorage(f.ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
  const bytes = await sharp({
    create: { width: 64, height: 32, channels: 4, background: { r: 9, g: 8, b: 7, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const sent = await storage.upload(
    f.actor,
    new Blob([bytes]).stream(),
    "image/png",
    "reaction_image",
  );
  // Not served to others before it is attached.
  await expect(storage.download(GUEST, sent.id)).rejects.toBeInstanceOf(Error);
  const type = await execute(f.ctx, reactionTypesCreateOp, f.actor, {
    ...base,
    fileId: sent.id,
    frameWidth: 32,
    frameHeight: 32,
    frameCount: 2,
  });
  expect(type.image?.fileId).toBe(sent.id);
  expect(type.frames).toEqual({ width: 32, height: 32, count: 2, columns: 2 });
  const served = await storage.download(GUEST, sent.id);
  expect((await sharp(served).metadata()).width).toBe(64);
});
