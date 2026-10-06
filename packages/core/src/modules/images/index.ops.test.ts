import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { nodesGetOp } from "../forums";
import { profilesGetOp } from "../profiles";
import { createStorage, localDriver } from "../storage";
import { operations } from "./index";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
function stream() {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(png);
      controller.close();
    },
  });
}

describe("avatar, cover, and node images", () => {
  test("owned uploads attach to profiles and nodes with generated variants", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-image-ops-"));
    const ctx = createTestContext();
    try {
      const memberRow = insertUser(ctx);
      const member = userActor(memberRow);
      const other = userActor(insertUser(ctx));
      const admin = userActor(insertUser(ctx, { groupId: 4 }));
      const node = insertNode(ctx, {});
      invalidate(ctx, "node_tree");
      const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
      const avatar = await storage.upload(member, stream(), "image/png", "avatar");
      const avatarOp = operations.find((op) => op.name === "images.setAvatar")!;
      const nodeIconOp = operations.find((op) => op.name === "images.setNodeIcon")!;
      await expect(execute(ctx, avatarOp, GUEST, { fileId: avatar.id })).rejects.toThrow(
        UnauthenticatedError,
      );
      await expect(execute(ctx, avatarOp, other, { fileId: avatar.id })).rejects.toThrow(
        NotFoundError,
      );
      await execute(ctx, avatarOp, member, { fileId: avatar.id });
      ctx.config.publicFileBaseURL = "https://cdn.example.test";
      expect(
        (await execute(ctx, profilesGetOp, GUEST, { userId: memberRow.id })).avatar?.fileId,
      ).toBe(avatar.id);
      expect((await execute(ctx, profilesGetOp, GUEST, { userId: memberRow.id })).avatar?.url).toBe(
        `https://cdn.example.test/api/v1/files/${avatar.id}`,
      );
      const metadata = ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM files WHERE parent_file_id = ?1 AND visibility = 'public'",
        )
        .get(avatar.id)!;
      expect(metadata.n).toBe(3);

      const icon = await storage.upload(admin, stream(), "image/png", "node_icon");
      await expect(
        execute(ctx, nodeIconOp, member, { nodeId: node.id, fileId: icon.id }),
      ).rejects.toThrow(ForbiddenError);
      await execute(ctx, nodeIconOp, admin, { nodeId: node.id, fileId: icon.id });
      expect((await execute(ctx, nodesGetOp, GUEST, { nodeId: node.id })).node.icon?.fileId).toBe(
        icon.id,
      );
    } finally {
      ctx.sqlite.close(true);
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  test("a custom admin.nodes grant permits node images without administrator group membership", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sermo-image-permission-"));
    const ctx = createTestContext();
    try {
      const memberRow = insertUser(ctx);
      const member = userActor(memberRow);
      const node = insertNode(ctx, {});
      const groupId = ctx.sqlite
        .prepare<{ id: number }, []>(
          "INSERT INTO groups (title, rank) VALUES ('Node image managers', 10) RETURNING id",
        )
        .get()!.id;
      ctx.sqlite
        .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
        .run(memberRow.id, groupId);
      const storage = createStorage(ctx, { driver: localDriver(join(dir, "files")), tempDir: dir });
      const icon = await storage.upload(member, stream(), "image/png", "node_icon");
      const cover = await storage.upload(member, stream(), "image/png", "node_cover");
      const iconOp = operations.find((op) => op.name === "images.setNodeIcon")!;
      const coverOp = operations.find((op) => op.name === "images.setNodeCover")!;
      await expect(
        execute(ctx, iconOp, GUEST, { nodeId: node.id, fileId: icon.id }),
      ).rejects.toThrow(UnauthenticatedError);
      await expect(
        execute(ctx, iconOp, member, { nodeId: node.id, fileId: icon.id }),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        execute(ctx, coverOp, member, { nodeId: node.id, fileId: cover.id }),
      ).rejects.toThrow(ForbiddenError);
      ctx.sqlite
        .prepare(
          "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ?1, 0, 1 FROM permission_definitions WHERE key = 'admin.nodes'",
        )
        .run(groupId);
      await execute(ctx, iconOp, member, { nodeId: node.id, fileId: icon.id });
      await execute(ctx, coverOp, member, { nodeId: node.id, fileId: cover.id });
      expect(
        ctx.sqlite
          .prepare<{ icon_file_id: number; cover_file_id: number }, [number]>(
            "SELECT icon_file_id, cover_file_id FROM nodes WHERE id = ?1",
          )
          .get(node.id),
      ).toEqual({ icon_file_id: icon.id, cover_file_id: cover.id });
    } finally {
      ctx.sqlite.close(true);
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
