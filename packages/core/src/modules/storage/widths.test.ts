import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import sharp from "sharp";
import { GUEST } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import { execute } from "../../operation";
import { mediaListOp } from "../feed/media";
import { postsCreateOp, postsListOp, threadsCreateOp } from "../forums";
import { backfillWidthCopies } from "./backfill";
import { createStorage, localDriver } from "./index";

const dirs: string[] = [];
const contexts: Ctx[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) ctx.sqlite.close(true);
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const stream = (data: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

const still = async (width: number, height: number) =>
  new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } })
      .jpeg()
      .toBuffer(),
  );
const moving = async (width: number, height: number) => {
  const frame = (red: number) =>
    sharp({ create: { width, height, channels: 3, background: { r: red, g: 0, b: 0 } } })
      .raw()
      .toBuffer();
  return new Uint8Array(
    await sharp(Buffer.concat([await frame(255), await frame(0)]), {
      raw: { width, height: height * 2, channels: 3, pageHeight: height },
    })
      .gif({ delay: [100, 100] })
      .toBuffer(),
  );
};

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "sermo-widths-"));
  dirs.push(dir);
  const ctx = createTestContext();
  contexts.push(ctx);
  const files = join(dir, "files");
  const driver = localDriver(files);
  const storage = createStorage(ctx, { driver, tempDir: join(dir, "temp") });
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const owner = userActor(insertUser(ctx));
  const { thread } = await execute(ctx, threadsCreateOp, owner, {
    nodeId: node.id,
    title: "Pictures",
    body: "Pictures",
  });
  const upload = async (data: Uint8Array, type = "image/jpeg") =>
    (await storage.upload(owner, stream(data), type, "attachment", "picture")).id;
  const post = (attachmentIds: number[]) =>
    execute(ctx, postsCreateOp, owner, { threadId: thread.id, body: "see", attachmentIds });
  const listed = async () =>
    (await execute(ctx, postsListOp, GUEST, { threadId: thread.id, limit: 20 })).items.flatMap(
      (item) => item.attachments,
    );
  const variants = (id: number) =>
    ctx.sqlite
      .prepare<
        { variant: string; width: number; visibility: string; attached_at: number | null },
        [number]
      >(
        "SELECT variant, width, visibility, attached_at FROM files WHERE parent_file_id = ?1 AND deleted_at IS NULL ORDER BY id",
      )
      .all(id);
  const variantUrl = (id: number, variant: string) =>
    `/api/v1/files/${
      ctx.sqlite
        .prepare<{ id: number }, [number, string]>(
          "SELECT id FROM files WHERE parent_file_id = ?1 AND variant = ?2",
        )
        .get(id, variant)!.id
    }`;
  // The pictures as stored before width copies were made: their copies gone, rows and bytes.
  const forgetCopies = async (variant = "width_%") => {
    const keys = ctx.sqlite
      .prepare<{ storage_key: string }, [string]>(
        "DELETE FROM files WHERE variant LIKE ?1 RETURNING storage_key",
      )
      .all(variant);
    for (const { storage_key } of keys) await driver.delete(storage_key);
  };
  // Every stored file has its row, and every row its stored file.
  const storedMatchesRows = async () => {
    const keys = ctx.sqlite
      .prepare<{ storage_key: string }, []>("SELECT storage_key FROM files ORDER BY storage_key")
      .all()
      .map((row) => row.storage_key);
    expect((await readdir(files)).sort()).toEqual(keys.sort());
  };
  const backfill = (after?: number) =>
    backfillWidthCopies(ctx, driver, { tempDir: join(dir, "backfill"), batchSize: 2, after });
  return {
    ctx,
    upload,
    post,
    listed,
    variants,
    variantUrl,
    forgetCopies,
    storedMatchesRows,
    backfill,
  };
}

describe("width copies of attachment pictures", () => {
  test("a post lists them after the thumbnail, narrowest first; a narrow picture, an animation and a file have none", async () => {
    const app = await setup();
    const wide = await app.upload(await still(1600, 1200));
    const mid = await app.upload(await still(900, 300));
    const narrow = await app.upload(await still(600, 400));
    const animation = await app.upload(await moving(1400, 300), "image/gif");
    const text = await app.upload(new TextEncoder().encode("plain words"), "text/plain");
    await app.post([wide, mid, narrow, animation, text]);
    const byId = new Map((await app.listed()).map((file) => [file.fileId, file]));
    const rows = app.variants(wide);
    expect(rows.map((row) => [row.variant, row.width])).toEqual([
      ["thumbnail", 320],
      ["width_640", 640],
      ["width_1280", 1280],
    ]);
    expect(byId.get(wide)!.widths).toEqual([
      { url: app.variantUrl(wide, "thumbnail"), width: 320 },
      { url: app.variantUrl(wide, "width_640"), width: 640 },
      { url: app.variantUrl(wide, "width_1280"), width: 1280 },
    ]);
    expect(byId.get(mid)!.widths.map((copy) => copy.width)).toEqual([320, 640]);
    expect(byId.get(narrow)!.widths).toEqual([]);
    expect(byId.get(animation)!.widths).toEqual([]);
    expect(app.variants(animation).map((row) => row.variant)).toEqual(["thumbnail"]);
    expect(byId.get(text)!.widths).toEqual([]);
    expect(app.variants(text)).toEqual([]);
    // The copies of a picture follow it when it is attached: public with the post.
    for (const row of rows) expect(row.visibility).toBe("public");
    expect(rows.every((row) => row.attached_at !== null)).toBe(true);
    // The media tab carries them too.
    const media = await execute(app.ctx, mediaListOp, GUEST, { limit: 10 });
    expect(media.items.find((item) => item.file.fileId === wide)!.file.widths).toEqual(
      byId.get(wide)!.widths,
    );
  });

  test("the backfill makes the copies older pictures lack, once, and leaves animations and deleted files alone", async () => {
    const app = await setup();
    const pictures = [
      await app.upload(await still(1600, 1200)),
      await app.upload(await still(900, 300)),
      await app.upload(await still(1500, 500)),
    ];
    const animation = await app.upload(await moving(1400, 300), "image/gif");
    const deleted = await app.upload(await still(1000, 1000));
    await app.post([...pictures, animation, deleted]);
    const before = pictures.map((id) => app.variants(id));
    await app.forgetCopies();
    app.ctx.sqlite.prepare("UPDATE files SET deleted_at = 1 WHERE id = ?1").run(deleted);
    expect((await app.listed()).every((file) => file.widths.length === 0)).toBe(true);

    const first = await app.backfill();
    expect(first).toEqual({ pictures: 4, created: 5, animated: 1, lastFileId: animation });
    // The same copies an upload makes, with the access of their picture.
    expect(pictures.map((id) => app.variants(id))).toEqual(before);
    expect(app.variants(deleted).map((row) => row.variant)).toEqual(["thumbnail"]);
    const listed = new Map((await app.listed()).map((file) => [file.fileId, file.widths.length]));
    expect(pictures.map((id) => listed.get(id))).toEqual([3, 2, 3]);
    await app.storedMatchesRows();

    // Run again: nothing left to do but the animation, which is read and passed over again.
    expect(await app.backfill()).toEqual({
      pictures: 1,
      created: 0,
      animated: 1,
      lastFileId: animation,
    });
    // From after the last picture done, nothing at all.
    expect(await app.backfill(first.lastFileId)).toMatchObject({ pictures: 0, created: 0 });

    // A run stopped between two copies of a picture: only the missing one is written, and the
    // copy made again of the one already there is not kept.
    await app.forgetCopies("width_1280");
    expect(await app.backfill()).toMatchObject({ pictures: 3, created: 2, animated: 1 });
    expect(app.variants(pictures[2]!).map((row) => row.variant)).toEqual([
      "thumbnail",
      "width_640",
      "width_1280",
    ]);
    await app.storedMatchesRows();
  });

  test("a copy written by the backfill has the access of its picture at that moment", async () => {
    const app = await setup();
    const picture = await app.upload(await still(1000, 800));
    await app.forgetCopies();
    // Not attached yet: the copy is the uploader's alone, like the picture.
    expect(await app.backfill()).toMatchObject({ created: 1 });
    expect(app.variants(picture).at(-1)).toEqual({
      variant: "width_640",
      width: 640,
      visibility: "unattached",
      attached_at: null,
    });
    // Attaching it later makes the copy public with it, as for an upload.
    await app.post([picture]);
    expect(app.variants(picture).at(-1)).toMatchObject({ visibility: "public" });
  });
});
