import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import sharp from "sharp";
import { GUEST } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import { execute } from "../../operation";
import { mediaListOp } from "../feed/media";
import { postsCreateOp, postsListOp, threadsCreateOp } from "../forums";
import { backfillWidthCopies, UNREADABLE_FLOOR } from "./backfill";
import { createStorage, localDriver, type StorageDriver } from "./index";

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
  const local = localDriver(files);
  // Reads go through `beforeRead` first, for a test to change the world as the backfill reads.
  let beforeRead = (_key: string) => {};
  const driver: StorageDriver = {
    ...local,
    read(key) {
      beforeRead(key);
      return local.read(key);
    },
  };
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
  const skipped: [number, string][] = [];
  const backfill = (after?: number) =>
    backfillWidthCopies(ctx, driver, {
      tempDir: join(dir, "backfill"),
      batchSize: 2,
      after,
      onSkip: (id, reason) => skipped.push([id, reason]),
    });
  const keyOf = (id: number) =>
    ctx.sqlite
      .prepare<{ storage_key: string }, [number]>("SELECT storage_key FROM files WHERE id = ?1")
      .get(id)!.storage_key;
  return {
    ctx,
    owner,
    files,
    driver,
    skipped,
    keyOf,
    onRead: (run: (key: string) => void) => {
      beforeRead = run;
    },
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
    expect(first).toEqual({
      pictures: 4,
      created: 5,
      animated: 1,
      skipped: 0,
      deleted: 0,
      lastFileId: animation,
    });
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
      skipped: 0,
      deleted: 0,
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

  test("a picture the backfill cannot read is passed over, told and counted, and the run goes on", async () => {
    const app = await setup();
    const ids = [];
    for (let index = 0; index < 5; index++) ids.push(await app.upload(await still(1000, 800)));
    await app.post(ids);
    await app.forgetCopies();
    const [missing, garbled, goneBefore, goneDuring, fine] = ids as [
      number,
      number,
      number,
      number,
      number,
    ];
    // Its bytes lost, its bytes not a picture, deleted (bytes and all) by a job as the run reads
    // it, and deleted as the run reads it with its bytes still there.
    await app.driver.delete(app.keyOf(missing));
    await writeFile(join(app.files, app.keyOf(garbled)), "not a picture at all");
    const goneKey = app.keyOf(goneBefore);
    app.onRead((key) => {
      for (const id of [goneBefore, goneDuring])
        if (key === app.keyOf(id))
          app.ctx.sqlite.prepare("UPDATE files SET deleted_at = -1 WHERE id = ?1").run(id);
      if (key === goneKey) rmSync(join(app.files, key));
    });
    const first = await app.backfill();
    expect(first).toMatchObject({
      pictures: 5,
      created: 1,
      skipped: 2,
      deleted: 2,
      lastFileId: fine,
    });
    expect(app.skipped).toEqual([
      [missing, "stored bytes missing"],
      [garbled, "stored bytes are not a picture that can be decoded"],
      [goneBefore, "deleted during the run"],
      [goneDuring, "deleted during the run"],
    ]);
    expect(app.variants(fine).map((row) => row.variant)).toEqual(["thumbnail", "width_640"]);
    for (const id of [missing, garbled, goneDuring])
      expect(app.variants(id).map((row) => row.variant)).toEqual(["thumbnail"]);
    // Nothing made for a picture passed over is left in storage.
    const kept = new Set(await readdir(app.files));
    const live = app.ctx.sqlite
      .prepare<{ storage_key: string }, []>(
        "SELECT storage_key FROM files WHERE variant GLOB 'width_*'",
      )
      .all();
    expect(live.map((row) => kept.has(row.storage_key))).toEqual([true]);
    expect(kept.size).toBe(
      app.ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM files").get()!.n - 2, // the two pictures whose bytes are gone
    );

    // A second run ends too: the two still listed are passed over again (the deleted ones are not
    // listed at all), and as nothing it read could be read, it says so instead of "complete".
    app.skipped.length = 0;
    await expect(app.backfill()).rejects.toThrow(
      "None of the 2 pictures read could be read; check the storage, then run again.",
    );
    expect(app.skipped.map(([id]) => id)).toEqual([missing, garbled]);
    // Started after them, there is nothing to do.
    expect(await app.backfill(garbled)).toMatchObject({ pictures: 0, skipped: 0 });
  });

  test("a failure that is not the picture's stops the run, naming the picture", async () => {
    const app = await setup();
    const ids = [
      await app.upload(await still(1000, 800)),
      await app.upload(await still(1000, 800)),
    ];
    await app.post(ids);
    await app.forgetCopies();
    const failing = app.keyOf(ids[1]!);
    app.onRead((key) => {
      if (key === failing) throw new Error("storage unavailable");
    });
    await expect(app.backfill()).rejects.toThrow(
      `Picture ${ids[1]} could not be copied: storage unavailable`,
    );
    // The one before was done; the failing one is neither done nor passed over.
    expect(app.variants(ids[0]!).map((row) => row.variant)).toContain("width_640");
    expect(app.variants(ids[1]!).map((row) => row.variant)).toEqual(["thumbnail"]);
    expect(app.skipped).toEqual([]);
    // So is a temp folder that cannot be written to (a full disk fails the same way).
    app.onRead(() => {});
    const blocked = join(app.files, "..", "not-a-folder");
    await writeFile(blocked, "a file where the temp folder should be");
    await expect(
      backfillWidthCopies(app.ctx, app.driver, { tempDir: join(blocked, "inside") }),
    ).rejects.toThrow();
    // Once it is fixed, the run takes up where it stopped.
    expect(await app.backfill()).toMatchObject({ pictures: 1, created: 1, skipped: 0 });
  });

  test("a run in which most pictures cannot be read stops, as the storage is failing", async () => {
    const app = await setup();
    const ids: number[] = [];
    for (let index = 0; index < UNREADABLE_FLOOR + 1; index++)
      ids.push(await app.upload(await still(700, 400)));
    await app.post(ids);
    await app.forgetCopies();
    // Every stored picture but the last has lost its bytes.
    for (const id of ids.slice(0, -1)) await app.driver.delete(app.keyOf(id));
    await expect(app.backfill()).rejects.toThrow(
      `${UNREADABLE_FLOOR} of ${UNREADABLE_FLOOR} pictures could not be read, through file ${ids.at(-2)}; check the storage, then run again.`,
    );
    // It stopped there: the last picture was not reached.
    expect(app.variants(ids.at(-1)!).map((row) => row.variant)).toEqual(["thumbnail"]);
  });

  test("a copy not smaller than the stored picture is not kept, and the picture is read again by the next run", async () => {
    const app = await setup();
    // A sharp-edged picture of two colours: a small PNG, and larger as lossy WebP at any width.
    const checks = new Uint8Array(
      await sharp(
        Buffer.from(
          Array.from({ length: 1400 * 700 }, (_, index) =>
            (((index % 1400) >> 4) + (Math.floor(index / 1400) >> 4)) % 2 ? 255 : 0,
          ),
        ),
        { raw: { width: 1400, height: 700, channels: 1 } },
      )
        .png({ palette: true })
        .toBuffer(),
    );
    const picture = await app.upload(checks, "image/png");
    await app.post([picture]);
    expect(app.variants(picture).map((row) => row.variant)).toEqual(["thumbnail"]);
    for (let run = 0; run < 2; run++)
      expect(await app.backfill()).toMatchObject({ pictures: 1, created: 0, skipped: 0 });
    expect(app.variants(picture).map((row) => row.variant)).toEqual(["thumbnail"]);
    await app.storedMatchesRows();
  });

  test("width copies count toward no member's storage quota, from an upload or the backfill", async () => {
    const app = await setup();
    const picture = await still(1600, 1200);
    const first = await app.upload(picture);
    const sizes = app.ctx.sqlite
      .prepare<{ variant: string | null; byte_size: number }, [number]>(
        "SELECT variant, byte_size FROM files WHERE id = ?1 OR parent_file_id = ?1",
      )
      .all(first);
    // What the member uploaded and its thumbnail count, as they always have.
    const counted = sizes
      .filter((row) => !row.variant?.startsWith("width_"))
      .reduce((total, row) => total + row.byte_size, 0);
    const copies = sizes.reduce((total, row) => total + row.byte_size, 0) - counted;
    expect(copies).toBeGreaterThan(10);
    // The Member group's quota, which the owner has.
    app.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, 2, 0, ?1 FROM permission_definitions WHERE key = 'attachment.storageQuota' ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = excluded.value",
      )
      .run(2 * counted + 10);
    invalidate(app.ctx, "permissions");
    // A second copy of the picture fits exactly, its width copies left out.
    const second = await app.upload(picture);
    expect(app.variants(second).map((row) => row.variant)).toContain("width_1280");
    // The backfill writing the copies again leaves the member the same room: 10 bytes.
    await app.forgetCopies();
    expect(await app.backfill()).toMatchObject({ created: 4 });
    const words = (count: number) => new TextEncoder().encode("x".repeat(count));
    expect(
      await app.upload(words(10), "text/plain").then(
        () => "kept",
        (error: Error) => error.message,
      ),
    ).toBe("kept");
    await expect(app.upload(words(1), "text/plain")).rejects.toThrow("Upload quota exceeded.");
  });
});
