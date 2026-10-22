import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import sharp from "sharp";
import type { Ctx } from "../../context";
import { SermoError } from "../../errors";
import { createStorage, localDriver } from "./index";
import { UPLOAD_REFUSAL_PATH } from "./refusal";

// What the temp directory holds while a body streams in, and how much of the disk and of the
// decoders one process gives to uploads.

const CHUNK = 64 * 1024;

let dir: string;
let ctx: Ctx;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sermo-bounds-"));
  ctx = createTestContext();
});
afterEach(async () => {
  ctx.sqlite.close(true);
  await rm(dir, { recursive: true, force: true });
});

const storage = (maxBytes?: number) =>
  createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir, maxBytes });

// A body of `chunks` chunks that reports, before each one, the largest temp file there is.
function watched(chunks: number, head: Uint8Array) {
  const seen = { largest: 0, sent: 0 };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // The writes of the chunks before this one have landed.
      await Bun.sleep(2);
      for (const name of await readdir(dir)) {
        if (!name.startsWith("sermo-")) continue;
        const { size } = await stat(join(dir, name)).catch(() => ({ size: 0 }));
        seen.largest = Math.max(seen.largest, size);
      }
      if (seen.sent === chunks) return controller.close();
      const chunk = new Uint8Array(CHUNK).fill(0x41);
      if (seen.sent === 0) chunk.set(head);
      seen.sent += 1;
      controller.enqueue(chunk);
    },
  });
  return { body, seen };
}

async function refusal(upload: Promise<unknown>) {
  const error = await upload.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof SermoError)) throw new Error("The upload was not refused.");
  return error.issues?.find((item) => item.path[0] === UPLOAD_REFUSAL_PATH)?.message;
}

const heicHead = Uint8Array.from([
  0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0, 0x68, 0x65, 0x69, 0x63,
  0x6d, 0x70, 0x34, 0x31,
]);

describe("a body that will be refused", () => {
  test("a type the declaration refuses is read to its end but keeps only its first bytes on the disk", async () => {
    const owner = userActor(insertUser(ctx));
    const { body, seen } = watched(48, new Uint8Array());
    expect(await refusal(storage().upload(owner, body, "application/x-msdownload"))).toBe("type");
    // Every chunk was taken, so the refusal reaches the browser as words ...
    expect(seen.sent).toBe(48);
    // ... and no more than a prefix was ever kept (3 MiB came in).
    expect(seen.largest).toBeLessThanOrEqual(64 * 1024);
    expect(await readdir(dir)).not.toContain(expect.stringMatching(/^sermo-/));
  });

  test("a HEIC photo is refused as one, whatever its size, with the same bound", async () => {
    const owner = userActor(insertUser(ctx));
    const { body, seen } = watched(48, heicHead);
    expect(await refusal(storage().upload(owner, body, "image/heic"))).toBe("heic");
    expect(seen.sent).toBe(48);
    expect(seen.largest).toBeLessThanOrEqual(64 * 1024);
    // A file declared as something else that is a HEIC is still named as one.
    const other = watched(4, heicHead);
    expect(await refusal(storage().upload(owner, other.body, "application/x-msdownload"))).toBe(
      "heic",
    );
  });

  test("a type the declaration allows is kept in full as it comes in", async () => {
    const owner = userActor(insertUser(ctx));
    const { body, seen } = watched(48, new Uint8Array());
    // Not a PDF, so it is refused at the end: what was written shows the check is real.
    expect(await refusal(storage().upload(owner, body, "application/pdf"))).toBe("unreadable");
    expect(seen.largest).toBeGreaterThan(64 * 1024);
  });

  test("the size limit still stops a refused body", async () => {
    const owner = userActor(insertUser(ctx));
    const { body } = watched(48, new Uint8Array());
    expect(await refusal(storage(CHUNK * 4).upload(owner, body, "application/x-msdownload"))).toBe(
      "size",
    );
  });
});

describe("decoding many pictures at once", () => {
  // Every decode of the process goes through the one gate of `images/decode-slots.ts`: count how
  // many are inside it at once while several pictures are uploaded together.
  test("at most two decodes run together, however many uploads arrive", async () => {
    const real = await import("../images/decode-slots");
    // Taken before the mock: the module object is patched in place, so `real.withDecodeSlot`
    // would point at the wrapper itself and the wrapper would call itself without end.
    const original = { ...real };
    const realSlot = original.withDecodeSlot;
    let inside = 0;
    let peak = 0;
    let total = 0;
    mock.module("../images/decode-slots", () => ({
      ...original,
      withDecodeSlot: <T>(run: () => Promise<T>) =>
        realSlot(async () => {
          inside += 1;
          total += 1;
          peak = Math.max(peak, inside);
          try {
            // Long enough for the others to be waiting.
            await Bun.sleep(5);
            return await run();
          } finally {
            inside -= 1;
          }
        }),
    }));
    try {
      const files = storage();
      const picture = new Uint8Array(
        await sharp({
          create: { width: 1200, height: 900, channels: 3, background: { r: 30, g: 120, b: 200 } },
        })
          .jpeg()
          .toBuffer(),
      );
      const stored = await Promise.all(
        Array.from({ length: 6 }, () =>
          files.upload(
            userActor(insertUser(ctx)),
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(picture);
                controller.close();
              },
            }),
            "image/jpeg",
          ),
        ),
      );
      expect(stored).toHaveLength(6);
      // Several decodes per picture, six pictures: far more than two were asked for ...
      expect(total).toBeGreaterThan(6);
      // ... and never more than two ran.
      expect(peak).toBe(2);
    } finally {
      mock.module("../images/decode-slots", () => original);
    }
  });
});
