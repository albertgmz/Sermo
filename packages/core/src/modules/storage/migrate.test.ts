import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTestContext, insertUser } from "@sermo/core/testing";
import { localDriver, type StorageDriver } from ".";
import { migrateStorageFiles } from "./migrate";

test("storage migration verifies bytes, resumes an uploaded file, and switches records individually", async () => {
  const root = await mkdtemp(join(process.cwd(), ".storage-migrate-test-"));
  const ctx = createTestContext();
  try {
    const sourceDir = join(root, "local");
    await mkdir(sourceDir);
    const owner = insertUser(ctx);
    const contents = [Buffer.from("first file"), Buffer.from("second file")];
    const keys = [randomUUID(), randomUUID()];
    for (let i = 0; i < contents.length; i++) {
      await writeFile(join(sourceDir, keys[i]!), contents[i]!);
      ctx.sqlite
        .prepare(
          "INSERT INTO files (id,driver,storage_key,byte_size,content_type,sha256,uploader_id,purpose,visibility,created_at) VALUES (?1,'local',?2,?3,'text/plain',?4,?5,'attachment','private',?6)",
        )
        .run(
          i + 1,
          keys[i]!,
          contents[i]!.length,
          createHash("sha256").update(contents[i]!).digest("hex"),
          owner.id,
          ctx.now(),
        );
    }
    const bucket = new Map<string, Buffer>();
    let interrupt = true;
    const destination: StorageDriver = {
      name: "s3",
      async exists(key) {
        return bucket.has(key);
      },
      async put(key, path) {
        bucket.set(key, Buffer.from(await Bun.file(path).arrayBuffer()));
        if (key === keys[1] && interrupt) throw new Error("interrupted after upload");
      },
      read(key) {
        return new Blob([Uint8Array.from(bucket.get(key) ?? [])]);
      },
      async delete(key) {
        bucket.delete(key);
      },
    };
    await expect(
      migrateStorageFiles(ctx, localDriver(sourceDir), destination, {
        tempDir: join(root, "temp"),
        batchSize: 1,
      }),
    ).rejects.toThrow("interrupted after upload");
    expect(
      ctx.sqlite
        .prepare<{ driver: string }, [number]>("SELECT driver FROM files WHERE id=?1")
        .get(1)?.driver,
    ).toBe("s3");
    expect(
      ctx.sqlite
        .prepare<{ driver: string }, [number]>("SELECT driver FROM files WHERE id=?1")
        .get(2)?.driver,
    ).toBe("local");
    interrupt = false;
    const result = await migrateStorageFiles(ctx, localDriver(sourceDir), destination, {
      tempDir: join(root, "temp"),
      batchSize: 1,
    });
    expect(result).toMatchObject({
      copied: 0,
      reused: 1,
      bytes: contents[1]!.length,
      lastFileId: 2,
    });
    expect(
      ctx.sqlite
        .prepare<{ driver: string }, [number]>("SELECT driver FROM files WHERE id=?1")
        .get(2)?.driver,
    ).toBe("s3");
    expect(bucket.get(keys[0]!)).toEqual(contents[0]);
    expect(bucket.get(keys[1]!)).toEqual(contents[1]);
    const badKey = randomUUID();
    await writeFile(join(sourceDir, badKey), "tampered");
    ctx.sqlite
      .prepare(
        "INSERT INTO files (id,driver,storage_key,byte_size,content_type,sha256,uploader_id,purpose,visibility,created_at) VALUES (3,'local',?1,8,'text/plain',?2,?3,'attachment','private',?4)",
      )
      .run(badKey, "0".repeat(64), owner.id, ctx.now());
    await expect(
      migrateStorageFiles(ctx, localDriver(sourceDir), destination, {
        tempDir: join(root, "temp"),
      }),
    ).rejects.toThrow("source differs");
    expect(
      ctx.sqlite.prepare<{ driver: string }, []>("SELECT driver FROM files WHERE id=3").get()
        ?.driver,
    ).toBe("local");
  } finally {
    ctx.sqlite.close(true);
    await rm(root, { recursive: true, force: true });
  }
});
