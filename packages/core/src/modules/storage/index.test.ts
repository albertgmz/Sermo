import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { NotFoundError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { conversationsCreateOp } from "../conversations";
import { postsCreateOp, postsDeleteOp, threadsCreateOp } from "../forums";
import { createStorage, fileUrl, localDriver, type StorageDriver, storageSql } from "./index";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/WZkAAAAASUVORK5CYII=",
    "base64",
  ),
);
function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("storage", () => {
  test("local upload hashes, persists metadata, and serves a safe image", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-storage-"));
    const ctx = createTestContext();
    try {
      const owner = userActor(insertUser(ctx));
      const other = userActor(insertUser(ctx));
      const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
      const uploaded = await storage.upload(owner, stream(png), "image/png");
      expect(uploaded.url).toBe(fileUrl(uploaded.id));
      const record = storage.get(owner, uploaded.id);
      expect(record.byte_size).toBe(png.byteLength);
      expect(record.sha256).toHaveLength(64);
      expect(record.visibility).toBe("unattached");
      expect(record.storage_key).not.toContain("/");
      expect(await storage.download(owner, uploaded.id)).toEqual(png);
      expect(storage.serve(owner, uploaded.id).headers.get("x-content-type-options")).toBe(
        "nosniff",
      );
      expect(storage.serve(owner, uploaded.id).headers.get("content-disposition")).toContain(
        "inline",
      );
      expect(() => storage.get(other, uploaded.id)).toThrow(NotFoundError);
      expect(() => storage.get(GUEST, uploaded.id)).toThrow(NotFoundError);
      expect(storage.staleUnattached(ctx.now() + 1)).toEqual([uploaded.id]);
      expectNoTableScan(ctx, storageSql.byId, [uploaded.id]);
      expectNoTableScan(ctx, storageSql.attachment, [uploaded.id]);
      expectNoTableScan(ctx, storageSql.stale, [ctx.now() + 1, 10]);
      await storage.deleteQueued(uploaded.id);
      expect(() => storage.get(owner, uploaded.id)).toThrow(NotFoundError);
    } finally {
      ctx.sqlite.close(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("stream limit, type mismatch, and SVG rejection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-storage-"));
    const ctx = createTestContext();
    try {
      const owner = userActor(insertUser(ctx));
      const storage = createStorage(ctx, {
        driver: localDriver(join(dir, "files")),
        tempDir: dir,
        maxBytes: 100,
      });
      await expect(storage.upload(owner, stream(png), "image/jpeg")).rejects.toThrow(
        ValidationError,
      );
      await expect(
        storage.upload(owner, stream(new Uint8Array(101)), "text/plain"),
      ).rejects.toThrow(ValidationError);
      await expect(
        storage.upload(
          owner,
          stream(new TextEncoder().encode("<svg onload=alert(1)>")),
          "text/plain",
        ),
      ).rejects.toThrow(ValidationError);
      await expect(storage.upload(owner, stream(png), "image/svg+xml")).rejects.toThrow(
        ValidationError,
      );
      expect(ctx.sqlite.query("SELECT count(*) AS n FROM files").get() as { n: number }).toEqual({
        n: 0,
      });
    } finally {
      ctx.sqlite.close(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("S3-shaped driver and private conversation access", async () => {
    const objects = new Map<string, Uint8Array>();
    const fakeS3: StorageDriver = {
      name: "s3",
      async put(key, path) {
        objects.set(key, await Bun.file(path).bytes());
      },
      read(key) {
        return new Blob([Uint8Array.from(objects.get(key)!)]);
      },
      async delete(key) {
        objects.delete(key);
      },
    };
    const dir = await mkdtemp(join(tmpdir(), "sermo-storage-"));
    const ctx = createTestContext();
    try {
      const owner = userActor(insertUser(ctx));
      const recipient = userActor(insertUser(ctx));
      const outsider = userActor(insertUser(ctx));
      const storage = createStorage(ctx, { driver: fakeS3, tempDir: dir });
      const uploaded = await storage.upload(owner, stream(png), "image/png");
      expect(storage.get(owner, uploaded.id).driver).toBe("s3");
      expect(objects.size).toBe(1);
      const conversation = await execute(ctx, conversationsCreateOp, owner, {
        title: "Private file",
        recipientIds: [recipient.kind === "guest" ? 0 : recipient.userId],
        body: "hello",
      });
      expect(() =>
        storage.attach(recipient, uploaded.id, "conversation_message", conversation.message.id),
      ).toThrow(NotFoundError);
      expect(
        storage.attach(owner, uploaded.id, "conversation_message", conversation.message.id)
          .visibility,
      ).toBe("private");
      expect(storage.get(owner, uploaded.id).id).toBe(uploaded.id);
      expect(storage.get(recipient, uploaded.id).id).toBe(uploaded.id);
      expect(() => storage.get(outsider, uploaded.id)).toThrow(NotFoundError);
      await storage.deleteQueued(uploaded.id);
      expect(objects.size).toBe(0);
    } finally {
      ctx.sqlite.close(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a soft-deleted post immediately hides its previously public attachment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-storage-"));
    const ctx = createTestContext();
    try {
      const node = insertNode(ctx, {});
      invalidate(ctx, "node_tree");
      const owner = userActor(insertUser(ctx));
      const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
      const thread = await execute(ctx, threadsCreateOp, owner, {
        nodeId: node.id,
        title: "Files",
        body: "First",
      });
      const post = await execute(ctx, postsCreateOp, owner, {
        threadId: thread.thread.id,
        body: "Reply",
      });
      const uploaded = await storage.upload(owner, stream(png), "image/png");
      storage.attach(owner, uploaded.id, "post", post.id);
      expect(storage.get(GUEST, uploaded.id).id).toBe(uploaded.id);
      await execute(ctx, postsDeleteOp, owner, { postId: post.id });
      expect(() => storage.get(GUEST, uploaded.id)).toThrow(NotFoundError);
      expect(() => storage.get(owner, uploaded.id)).toThrow(NotFoundError);
    } finally {
      ctx.sqlite.close(true);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
