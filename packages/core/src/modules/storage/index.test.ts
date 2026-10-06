import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
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
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
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
      const stored = await storage.download(owner, uploaded.id);
      expect(record.byte_size).toBe(stored.byteLength);
      expect(record.width).toBe(1);
      expect(record.height).toBe(1);
      expect(record.sha256).toHaveLength(64);
      expect(record.sha256).toBe(createHash("sha256").update(stored).digest("hex"));
      expect(record.visibility).toBe("unattached");
      expect(record.storage_key).not.toContain("/");
      const variants = ctx.sqlite
        .prepare<{ id: number; variant: string }, [number]>(
          "SELECT id, variant FROM files WHERE parent_file_id = ?1",
        )
        .all(uploaded.id);
      expect(variants).toHaveLength(1);
      expect(variants[0]?.variant).toBe("thumbnail");
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

  test("upload quota resolves the highest value across a member's groups", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-storage-"));
    const ctx = createTestContext();
    try {
      const group = ctx.sqlite
        .prepare<{ id: number }, []>(
          "INSERT INTO groups (title, rank) VALUES ('Small uploads', 10) RETURNING id",
        )
        .get()!.id;
      const definition = ctx.sqlite
        .prepare<{ id: number }, []>(
          "SELECT id FROM permission_definitions WHERE key = 'attachment.storageQuota'",
        )
        .get()!.id;
      ctx.sqlite
        .prepare(
          "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, ?2, 0, 1000)",
        )
        .run(definition, group);
      const member = insertUser(ctx, { groupId: group });
      const actor = userActor(member);
      const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
      const bytes = new TextEncoder().encode("x".repeat(1001));
      await expect(storage.upload(actor, stream(bytes), "text/plain")).rejects.toThrow(
        "Upload quota exceeded.",
      );
      ctx.sqlite
        .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 2, 0)")
        .run(member.id);
      const uploaded = await storage.upload(actor, stream(bytes), "text/plain");
      expect(storage.get(actor, uploaded.id).byte_size).toBe(1001);
      ctx.sqlite
        .prepare(
          "UPDATE permission_entries SET value = 1000 WHERE permission_id = ?1 AND node_id = 0 AND group_id = 2 AND user_id = 0",
        )
        .run(definition);
      await expect(storage.upload(actor, stream(bytes), "text/plain")).rejects.toThrow(
        "Upload quota exceeded.",
      );
      ctx.sqlite
        .prepare(
          "UPDATE permission_entries SET value = -1 WHERE permission_id = ?1 AND node_id = 0 AND group_id = 2 AND user_id = 0",
        )
        .run(definition);
      const unlimited = await storage.upload(actor, stream(bytes), "text/plain");
      expect(storage.get(actor, unlimited.id).byte_size).toBe(1001);
    } finally {
      ctx.sqlite.close(true);
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("upload quota counts generated image variants", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-storage-"));
    const ctx = createTestContext();
    try {
      const reference = userActor(insertUser(ctx));
      const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
      const sample = await storage.upload(reference, stream(png), "image/png");
      const variant = ctx.sqlite
        .prepare<{ byte_size: number }, [number]>(
          "SELECT byte_size FROM files WHERE parent_file_id = ?1",
        )
        .get(sample.id)!;
      expect(variant.byte_size).toBeGreaterThan(0);
      const group = ctx.sqlite
        .prepare<{ id: number }, []>(
          "INSERT INTO groups (title, rank) VALUES ('Image quota', 10) RETURNING id",
        )
        .get()!.id;
      ctx.sqlite
        .prepare(
          "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = 'attachment.storageQuota'), 0, ?1, 0, ?2)",
        )
        .run(group, storage.get(reference, sample.id).byte_size);
      const actor = userActor(insertUser(ctx, { groupId: group }));
      await expect(storage.upload(actor, stream(png), "image/png")).rejects.toThrow(
        "Upload quota exceeded.",
      );
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
      expect(objects.size).toBe(2);
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
      ctx.sqlite
        .prepare("UPDATE conversation_messages SET state = 'moderated' WHERE id = ?1")
        .run(conversation.message.id);
      expect(storage.get(owner, uploaded.id).id).toBe(uploaded.id);
      expect(() => storage.get(recipient, uploaded.id)).toThrow(NotFoundError);
      const definition = ctx.sqlite
        .prepare<{ id: number }, []>(
          "SELECT id FROM permission_definitions WHERE key = 'conversation.viewHidden'",
        )
        .get()!.id;
      ctx.sqlite
        .prepare(
          "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 0, ?2, 1)",
        )
        .run(definition, recipient.kind === "guest" ? 0 : recipient.userId);
      expect(storage.get(recipient, uploaded.id).id).toBe(uploaded.id);
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
      expect((await storage.download(GUEST, uploaded.id)).byteLength).toBeGreaterThan(0);
      const attachmentPermission = ctx.sqlite
        .prepare<{ id: number }, []>(
          "SELECT id FROM permission_definitions WHERE key = 'forum.viewAttachments'",
        )
        .get()!.id;
      ctx.sqlite
        .prepare(
          "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, ?2, 1, 0, -1)",
        )
        .run(attachmentPermission, node.id);
      expect(() => storage.get(GUEST, uploaded.id)).toThrow(NotFoundError);
      await expect(storage.download(GUEST, uploaded.id)).rejects.toThrow(NotFoundError);
      ctx.sqlite
        .prepare(
          "DELETE FROM permission_entries WHERE permission_id = ?1 AND node_id = ?2 AND group_id = 1 AND user_id = 0",
        )
        .run(attachmentPermission, node.id);
      expect(storage.get(GUEST, uploaded.id).id).toBe(uploaded.id);
      await execute(ctx, postsDeleteOp, owner, { postId: post.id });
      expect(() => storage.get(GUEST, uploaded.id)).toThrow(NotFoundError);
      expect(() => storage.get(owner, uploaded.id)).toThrow(NotFoundError);
      const variant = ctx.sqlite
        .prepare<{ id: number }, [number]>("SELECT id FROM files WHERE parent_file_id = ?1")
        .get(uploaded.id)!;
      expect(() => storage.get(GUEST, variant.id)).toThrow(NotFoundError);
    } finally {
      ctx.sqlite.close(true);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
