import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { invalidate } from "../../context";
import { GROUP_IDS } from "../../db/schema";
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { dispatchEvents } from "../../events";
import { execute } from "../../operation";
import { conversationsCreateOp } from "../conversations";
import { preferencesUpdateOp, registerSocialJobs } from "../social";
import { postsPreviewOp, threadsCreateOp, threadsSetLockedOp } from "./index";

function setup() {
  const ctx = createTestContext();
  const category = insertNode(ctx, { type: "category" });
  const forum = insertNode(ctx, { parentId: category.id });
  invalidate(ctx, "node_tree");
  const member = userActor(insertUser(ctx, { username: "Ember" }));
  const other = userActor(insertUser(ctx, { username: "Wren" }));
  const mod = userActor(insertUser(ctx, { groupId: GROUP_IDS.moderator }));
  return { ctx, category, forum, member, other, mod };
}

// Every row any statement on the connection inserted, changed or deleted since it opened.
const changes = (ctx: ReturnType<typeof createTestContext>) =>
  ctx.sqlite.query<{ n: number }, []>("SELECT total_changes() AS n").get()!.n;

const BODY = "[b]Bold[/b] and [i]more[/i], for @Wren :) [url=https://example.test]a link[/url]";

test("a preview is the text as the saved post renders it, and it writes nothing", async () => {
  const { ctx, forum, member } = setup();
  const before = changes(ctx);
  const preview = await execute(ctx, postsPreviewOp, member, {
    target: { type: "thread", nodeId: forum.id },
    body: BODY,
  });
  expect(changes(ctx)).toBe(before);
  const saved = await execute(ctx, threadsCreateOp, member, {
    nodeId: forum.id,
    title: "Saved",
    body: BODY,
  });
  expect(preview.html).toBe(saved.post.bodyHtml);
  expect(preview.html).toContain("<strong>Bold</strong>");
  expect(preview.html).toContain('class="mention"');
  // The same for a reply in the thread and a message, which are rendered as they are saved too.
  const reply = await execute(ctx, postsPreviewOp, member, {
    target: { type: "reply", threadId: saved.thread.id },
    body: BODY,
  });
  const message = await execute(ctx, postsPreviewOp, member, {
    target: { type: "message" },
    body: BODY,
  });
  expect(reply.html).toContain("<strong>Bold</strong>");
  expect(message.html).toContain("<strong>Bold</strong>");
});

test("a preview is refused wherever posting is", async () => {
  const { ctx, category, forum, member, other, mod } = setup();
  const preview = (actor: typeof member, target: object) =>
    execute(ctx, postsPreviewOp, actor, { target, body: "Text" } as never);
  await expect(preview(GUEST, { type: "thread", nodeId: forum.id })).rejects.toBeInstanceOf(
    UnauthenticatedError,
  );
  await expect(preview(member, { type: "thread", nodeId: category.id })).rejects.toBeInstanceOf(
    ValidationError,
  );
  // A forum where members may not start threads.
  const closed = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = 'forum.createThread'), ?1, ?2, 0, -1)",
    )
    .run(closed.id, GROUP_IDS.member);
  invalidate(ctx, "permissions");
  await expect(preview(member, { type: "thread", nodeId: closed.id })).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  // A locked thread takes replies from moderators only.
  const { thread } = await execute(ctx, threadsCreateOp, member, {
    nodeId: forum.id,
    title: "Locked",
    body: "Text",
  });
  await execute(ctx, threadsSetLockedOp, mod, { threadId: thread.id, isLocked: true });
  await expect(preview(member, { type: "reply", threadId: thread.id })).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  expect((await preview(mod, { type: "reply", threadId: thread.id })).html).toContain("Text");
  // A conversation the member is not in is not there for them.
  const { conversation } = await execute(ctx, conversationsCreateOp, other, {
    title: "Private",
    recipientIds: [actorUserId(mod)!],
    body: "Hello",
  });
  await expect(
    preview(member, { type: "message", conversationId: conversation.id }),
  ).rejects.toBeInstanceOf(NotFoundError);
});

test("the author's choice of watching a new thread is applied with it, and without one the preference is", async () => {
  const { ctx, forum, member } = setup();
  registerSocialJobs(ctx);
  const watch = (threadId: number) =>
    ctx.sqlite
      .query<{ email: number }, [number, number]>(
        "SELECT email FROM thread_watches WHERE thread_id = ?1 AND user_id = ?2",
      )
      .get(threadId, actorUserId(member)!);
  const start = async (choice?: "none" | "watch" | "watch_email") => {
    const { thread } = await execute(ctx, threadsCreateOp, member, {
      nodeId: forum.id,
      title: "A thread",
      body: "Text",
      ...(choice ? { watch: choice } : {}),
    });
    return thread.id;
  };
  // The preference is to watch: a thread started without watching stays unwatched once the
  // background watch has run, and one asked with emails has them at once.
  const unwatched = await start("none");
  const withEmail = await start("watch_email");
  expect(watch(withEmail)?.email).toBe(1);
  const plain = await start();
  await dispatchEvents(ctx);
  expect(watch(unwatched)).toBeNull();
  expect(watch(withEmail)?.email).toBe(1);
  expect(watch(plain)?.email).toBe(0);
  // The preference is not to watch: an explicit watch still applies, no choice follows it.
  await execute(ctx, preferencesUpdateOp, member, { watchOnCreate: "none" });
  const asked = await start("watch");
  const none = await start();
  await dispatchEvents(ctx);
  expect(watch(asked)?.email).toBe(0);
  expect(watch(none)).toBeNull();
});
