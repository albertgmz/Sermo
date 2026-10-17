import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import sharp from "sharp";
import type { Ctx } from "../../context";
import { createStorage, localDriver } from "./index";

// The smallest headers the content sniffer recognises, padded so that each looks like a file.
const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat(
    parts.map((part) =>
      typeof part === "string" ? Buffer.from(part, "latin1") : Buffer.from(part),
    ),
  );
const padded = (head: Buffer) => new Uint8Array(Buffer.concat([head, Buffer.alloc(4096, 0x20)]));
const ftyp = (brand: string) => bytes([0, 0, 0, 0x18], "ftyp", brand, [0, 0, 0, 0], brand, "mp41");
const ebml = bytes(
  [0x42, 0x86, 0x81, 1, 0x42, 0xf7, 0x81, 1, 0x42, 0xf2, 0x81, 4, 0x42, 0xf3, 0x81, 8],
  [0x42, 0x82, 0x84],
  "webm",
  [0x42, 0x87, 0x81, 4, 0x42, 0x85, 0x81, 2],
);
const mpegFrame = bytes([0xff, 0xfb, 0x90, 0x64], Array(413).fill(0));
const fixtures = {
  mp4: padded(ftyp("isom")),
  mov: padded(ftyp("qt  ")),
  m4a: padded(ftyp("M4A ")),
  webm: padded(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | ebml.length]), ebml])),
  mp3: padded(Buffer.concat([mpegFrame, mpegFrame, mpegFrame, mpegFrame])),
  ogg: padded(
    bytes(
      "OggS",
      [0, 2, ...Array(8).fill(0), 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 30, 1],
      "vorbis",
    ),
  ),
  wav: padded(
    bytes(
      "RIFF",
      [36, 0, 0, 0],
      "WAVEfmt ",
      [16, 0, 0, 0, 1, 0, 1, 0, 0x44, 0xac, 0, 0, 0x88, 0x58, 1, 0, 2, 0, 16, 0],
      "data",
      [0, 0, 0, 0],
    ),
  ),
};

function stream(data: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

async function withStorage(
  run: (
    storage: ReturnType<typeof createStorage>,
    owner: ReturnType<typeof userActor>,
    ctx: Ctx,
  ) => Promise<void>,
  allowedTypesByPurpose?: Parameters<typeof createStorage>[1]["allowedTypesByPurpose"],
) {
  const dir = await mkdtemp(join(tmpdir(), "sermo-media-"));
  const ctx = createTestContext();
  try {
    const storage = createStorage(ctx, {
      driver: localDriver(join(dir, "files")),
      tempDir: dir,
      allowedTypesByPurpose,
    });
    await run(storage, userActor(insertUser(ctx)), ctx);
  } finally {
    ctx.sqlite.close(true);
    await rm(dir, { recursive: true, force: true });
  }
}

describe("video and audio attachments", () => {
  // Each file goes up with the type a browser names it by and is stored under one name for it.
  const cases = [
    ["mp4", "video/mp4", "video/mp4"],
    ["webm", "video/webm", "video/webm"],
    ["mov", "video/quicktime", "video/quicktime"],
    ["mp3", "audio/mpeg", "audio/mpeg"],
    ["m4a", "audio/x-m4a", "audio/mp4"],
    ["m4a", "audio/mp4", "audio/mp4"],
    ["ogg", "audio/ogg", "audio/ogg"],
    ["wav", "audio/wav", "audio/wav"],
    ["wav", "audio/x-wav", "audio/wav"],
  ] as const;
  for (const [kind, declared, stored] of cases)
    test(`${kind} sent as ${declared} is stored as uploaded, as ${stored}, and played inline`, () =>
      withStorage(async (storage, owner, ctx) => {
        const data = fixtures[kind];
        const uploaded = await storage.upload(
          owner,
          stream(data),
          declared,
          "attachment",
          `clip.${kind}`,
        );
        expect(uploaded.contentType).toBe(stored);
        expect(uploaded.byteSize).toBe(data.byteLength);
        const record = storage.get(owner, uploaded.id);
        expect(record.content_type).toBe(stored);
        expect(record.width).toBeNull();
        expect(record.height).toBeNull();
        expect(record.filename).toBe(`clip.${kind}`);
        // Not decoded or re-encoded: the same bytes, and no renditions.
        expect(
          Buffer.from(await storage.download(owner, uploaded.id)).equals(Buffer.from(data)),
        ).toBe(true);
        expect(record.sha256).toBe(createHash("sha256").update(data).digest("hex"));
        expect(
          ctx.sqlite
            .prepare<{ n: number }, [number]>(
              "SELECT count(*) AS n FROM files WHERE parent_file_id = ?1",
            )
            .get(uploaded.id)!.n,
        ).toBe(0);
        const response = storage.serve(owner, uploaded.id);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(stored);
        expect(response.headers.get("content-disposition")).toStartWith("inline");
        expect(response.headers.get("accept-ranges")).toBe("bytes");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      }));

  test("the bytes decide: a file whose content is not the type it is sent as is refused", () =>
    withStorage(async (storage, owner) => {
      await expect(storage.upload(owner, stream(fixtures.mp3), "video/mp4")).rejects.toThrow(
        "File type does not match its content.",
      );
      await expect(storage.upload(owner, stream(fixtures.mov), "video/mp4")).rejects.toThrow(
        "File type does not match its content.",
      );
      await expect(
        storage.upload(owner, stream(new TextEncoder().encode("not a video at all")), "video/mp4"),
      ).rejects.toThrow("File type could not be verified.");
      // A type the site does not take is refused whatever its content.
      await expect(storage.upload(owner, stream(fixtures.mp4), "video/x-matroska")).rejects.toThrow(
        "File type is not allowed.",
      );
    }));

  test("the site's allowed types for attachments decide, under the stored name", () =>
    withStorage(
      async (storage, owner) => {
        await expect(storage.upload(owner, stream(fixtures.mp4), "video/mp4")).rejects.toThrow(
          "File type is not allowed.",
        );
        // `audio/x-m4a` is checked as `audio/mp4`, which the site takes.
        const m4a = await storage.upload(owner, stream(fixtures.m4a), "audio/x-m4a");
        expect(m4a.contentType).toBe("audio/mp4");
        // Not for an avatar.
        await expect(
          storage.upload(owner, stream(fixtures.m4a), "audio/mp4", "avatar"),
        ).rejects.toThrow("File type is not allowed.");
      },
      { attachment: ["audio/mp4"], avatar: ["image/png"] },
    ));
});

describe("byte ranges", () => {
  test("a player gets the part it asks for, and only a whole-file read counts as a download", () =>
    withStorage(async (storage, owner, ctx) => {
      const data = fixtures.mp4;
      const size = data.byteLength;
      const { id } = await storage.upload(owner, stream(data), "video/mp4");
      const part = async (range: string | null) => {
        const response = storage.serve(owner, id, new Headers(range === null ? {} : { range }));
        return {
          status: response.status,
          range: response.headers.get("content-range"),
          length: response.headers.get("content-length"),
          body: new Uint8Array(await response.arrayBuffer()),
        };
      };
      ctx.downloads.clear();

      const first = await part("bytes=0-9");
      expect(first).toMatchObject({ status: 206, range: `bytes 0-9/${size}`, length: "10" });
      expect(first.body).toEqual(data.subarray(0, 10));
      expect(ctx.downloads.get(id)).toBeUndefined();

      const middle = await part("bytes=100-199");
      expect(middle).toMatchObject({ status: 206, range: `bytes 100-199/${size}`, length: "100" });
      expect(middle.body).toEqual(data.subarray(100, 200));
      const open = await part("bytes=4000-");
      expect(open).toMatchObject({ status: 206, range: `bytes 4000-${size - 1}/${size}` });
      expect(open.body).toEqual(data.subarray(4000));
      const tail = await part("bytes=-16");
      expect(tail).toMatchObject({ status: 206, range: `bytes ${size - 16}-${size - 1}/${size}` });
      expect(tail.body).toEqual(data.subarray(size - 16));
      // An end past the file is cut to the file.
      expect(await part(`bytes=10-${size + 500}`)).toMatchObject({
        status: 206,
        range: `bytes 10-${size - 1}/${size}`,
      });
      // No read with a range counts, from the first byte or not: players always send one.
      expect(ctx.downloads.get(id)).toBeUndefined();

      expect(await part(`bytes=${size}-`)).toMatchObject({ status: 416, range: `bytes */${size}` });
      expect(await part("bytes=-0")).toMatchObject({ status: 416, range: `bytes */${size}` });
      // What is not one plain range is answered with the whole file.
      for (const ignored of ["bytes=20-10", "bytes=0-1,5-9", "items=0-1", "bytes=x-1", null]) {
        const whole = await part(ignored);
        expect(whole, String(ignored)).toMatchObject({
          status: 200,
          range: null,
          length: String(size),
        });
        expect(whole.body).toEqual(data);
      }
      expect(ctx.downloads.get(id)).toBe(1);
    }));
});

describe("pictures stored in another format", () => {
  test("keep their name with the extension of what is stored", () =>
    withStorage(async (storage, owner) => {
      const frame = (red: number) =>
        sharp({ create: { width: 4, height: 4, channels: 3, background: { r: red, g: 0, b: 0 } } })
          .raw()
          .toBuffer();
      const still = await sharp(await frame(255), { raw: { width: 4, height: 4, channels: 3 } })
        .gif()
        .toBuffer();
      const moving = await sharp(Buffer.concat([await frame(255), await frame(0)]), {
        raw: { width: 4, height: 8, channels: 3, pageHeight: 4 },
      })
        .gif({ delay: [100, 100] })
        .toBuffer();
      const name = async (bytes: Buffer, original: string) => {
        const { id, contentType } = await storage.upload(
          owner,
          stream(new Uint8Array(bytes)),
          "image/gif",
          "attachment",
          original,
        );
        return [contentType, storage.get(owner, id).filename];
      };
      expect(await name(still, "holiday.gif")).toEqual(["image/png", "holiday.png"]);
      expect(await name(moving, "holiday.GIF")).toEqual(["image/webp", "holiday.webp"]);
      expect(await name(moving, "no extension")).toEqual(["image/webp", "no extension.webp"]);
    }));
});
