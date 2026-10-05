import { describe, expect, test } from "bun:test";
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
import { conversationsCreateOp, conversationsListMessagesOp } from "../conversations";
import {
  postsCreateOp,
  postsDeleteOp,
  postsListOp,
  postsUpdateOp,
  threadsCreateOp,
} from "../forums";
import { flushDownloadCounts } from "../jobs";
import { profilePostsCreateOp, profilePostsListOp } from "../profiles";
import { createStorage, getFileRecord } from "../storage";
import { attachmentsPageSql } from "./index";

function file(ctx: ReturnType<typeof createTestContext>, uploaderId: number, mime = "text/plain") {
  return Number(
    ctx.sqlite
      .prepare(
        "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at) VALUES ('fake', ?1, 4, ?2, 'hash', ?3, 'attachment', 'unattached', ?4)",
      )
      .run(crypto.randomUUID(), mime, uploaderId, ctx.now()).lastInsertRowid,
  );
}

describe("attachments", () => {
  test("post create, edit, list, and removal are transactional and permission checked", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const owner = userActor(insertUser(ctx));
    const other = userActor(insertUser(ctx));
    if (owner.kind === "guest" || other.kind === "guest") throw new Error("fixture");
    const initial = await execute(ctx, threadsCreateOp, owner, {
      nodeId: node.id,
      title: "A",
      body: "A",
    });
    const image = file(ctx, owner.userId, "image/png");
    const foreign = file(ctx, other.userId);
    await expect(
      execute(ctx, postsCreateOp, owner, {
        threadId: initial.thread.id,
        body: "bad",
        attachmentIds: [foreign],
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(ctx, postsCreateOp, owner, {
        threadId: initial.thread.id,
        body: "bad",
        attachmentIds: [image, image],
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, postsCreateOp, owner, {
        threadId: initial.thread.id,
        body: `![wrong](/api/v1/files/${image})`,
      }),
    ).rejects.toThrow(ValidationError);
    const post = await execute(ctx, postsCreateOp, owner, {
      threadId: initial.thread.id,
      body: `![photo](/api/v1/files/${image})`,
      attachmentIds: [image],
    });
    expect(post.attachmentCount).toBe(1);
    expect(post.attachments[0]?.fileId).toBe(image);
    expect(post.bodyHtml).toContain(`/api/v1/files/${image}`);
    expect(
      (await execute(ctx, postsListOp, GUEST, { threadId: initial.thread.id, limit: 20 })).items.at(
        -1,
      )?.attachments,
    ).toHaveLength(1);
    expect(getFileRecord(ctx, GUEST, image).id).toBe(image);
    const changed = await execute(ctx, postsUpdateOp, owner, {
      postId: post.id,
      body: "plain",
      attachmentIds: [],
    });
    expect(changed.attachmentCount).toBe(0);
    expect(changed.attachments).toEqual([]);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT attachment_count AS n FROM posts WHERE id = ?1")
        .get(post.id)?.n,
    ).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT COUNT(*) AS n FROM jobs WHERE type = 'storage.deletePermanent' AND json_extract(payload, '$.id') = ?1",
        )
        .get(image)?.n,
    ).toBe(1);
    const hiddenFile = file(ctx, owner.userId);
    const hidden = await execute(ctx, postsCreateOp, owner, {
      threadId: initial.thread.id,
      body: "hidden",
      attachmentIds: [hiddenFile],
    });
    await execute(ctx, postsDeleteOp, owner, { postId: hidden.id });
    expect(() => getFileRecord(ctx, GUEST, hiddenFile)).toThrow(NotFoundError);
    expectNoTableScan(ctx, attachmentsPageSql, ["post", JSON.stringify([post.id])]);
    const plan = ctx.sqlite
      .prepare<{ detail: string }, [string, string]>(`EXPLAIN QUERY PLAN ${attachmentsPageSql}`)
      .all("post", JSON.stringify([post.id]));
    expect(
      plan.some((step) => step.detail.includes("SEARCH thumb USING INDEX files_variant")),
    ).toBe(true);
  });

  test("profile and conversation pages expose attached metadata only to content viewers", async () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    const recipient = userActor(insertUser(ctx));
    const stranger = userActor(insertUser(ctx));
    if (author.kind === "guest" || recipient.kind === "guest") throw new Error("fixture");
    const profileFile = file(ctx, author.userId);
    const profile = await execute(ctx, profilePostsCreateOp, author, {
      userId: author.userId,
      body: "profile",
      attachmentIds: [profileFile],
    });
    expect(profile.attachmentCount).toBe(1);
    expect(
      (await execute(ctx, profilePostsListOp, GUEST, { userId: author.userId, limit: 20 })).items[0]
        ?.attachments[0]?.fileId,
    ).toBe(profileFile);
    const privateFile = file(ctx, author.userId);
    const conversation = await execute(ctx, conversationsCreateOp, author, {
      title: "Private",
      recipientIds: [recipient.userId],
      body: "secret",
      attachmentIds: [privateFile],
    });
    expect(conversation.message.attachments[0]?.fileId).toBe(privateFile);
    expect(
      (
        await execute(ctx, conversationsListMessagesOp, recipient, {
          conversationId: conversation.conversation.id,
          limit: 20,
        })
      ).items[0]?.attachmentCount,
    ).toBe(1);
    expect(getFileRecord(ctx, recipient, privateFile).id).toBe(privateFile);
    expect(() => getFileRecord(ctx, stranger, privateFile)).toThrow(NotFoundError);
    expect(() => getFileRecord(ctx, GUEST, privateFile)).toThrow(NotFoundError);
    const storage = createStorage(ctx, {
      driver: {
        name: "fake",
        async put() {},
        read() {
          return new Blob(["file"]);
        },
        async delete() {},
      },
      tempDir: ".",
    });
    expect(storage.serve(recipient, privateFile).status).toBe(200);
    expect(ctx.downloads.get(privateFile)).toBe(1);
    expect(flushDownloadCounts(ctx)).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ count: number }, [number]>(
          "SELECT download_count AS count FROM files WHERE id = ?1",
        )
        .get(privateFile)?.count,
    ).toBe(1);
  });
});
