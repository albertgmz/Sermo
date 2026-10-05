import { expect, test } from "bun:test";
import { createTestContext, insertUser } from "@sermo/core/testing";
import { writeTx } from "../../db/tx";
import { publishEvent } from "../../events";
import { runDueJobs } from "../jobs";
import { queueStorageEvents, registerStorageJobs, type StorageDriver } from ".";

test("file cleanup subscriber queues permanent deletion from a committed domain event", async () => {
  const ctx = createTestContext();
  const uploader = insertUser(ctx);
  const deleted: string[] = [];
  const driver: StorageDriver = {
    name: "fake",
    async put() {},
    read() {
      return new Blob([]);
    },
    async delete(key) {
      deleted.push(key);
    },
  };
  ctx.sqlite
    .prepare(
      "INSERT INTO files (id,driver,storage_key,byte_size,content_type,sha256,uploader_id,purpose,visibility,created_at) VALUES (1,'fake','fake-key',1,'text/plain','hash',?1,'attachment','private',?2)",
    )
    .run(uploader.id, ctx.now());
  registerStorageJobs(ctx, { driver, tempDir: "." });
  writeTx(ctx, () => {
    publishEvent(ctx, {
      type: "content.deleted",
      targetType: "post",
      targetId: 1,
      payload: { permanent: true, fileIds: [1] },
    });
  });
  queueStorageEvents(ctx);
  await runDueJobs(ctx);
  expect(deleted).toEqual(["fake-key"]);
  expect(
    ctx.sqlite.prepare<{ deleted_at: number }, []>("SELECT deleted_at FROM files WHERE id=1").get()
      ?.deleted_at,
  ).toBe(ctx.now());
});
