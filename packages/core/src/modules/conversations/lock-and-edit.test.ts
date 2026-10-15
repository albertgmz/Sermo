import { describe, expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { dispatchEvents } from "../../events";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { runDueJobs } from "../jobs";
import { registerNotificationJobs } from "../notifications";
import {
  conversationsCreateOp,
  conversationsDeleteMessageOp,
  conversationsGetMessageOp,
  conversationsGetOp,
  conversationsListMessagesOp,
  conversationsReplyOp,
  conversationsSetLockedOp,
  conversationsUpdateMessageOp,
  firstMessageSql,
  messageSql,
} from "./index";

/** a starts the conversation with b and c; the admin (holder of conversation.moderate) joins. */
async function setup() {
  const ctx = createTestContext();
  const aUser = insertUser(ctx);
  const bUser = insertUser(ctx);
  const cUser = insertUser(ctx);
  const outsiderUser = insertUser(ctx);
  const adminUser = insertUser(ctx, { groupId: 4 });
  const a = userActor(aUser);
  const b = userActor(bUser);
  const c = userActor(cUser);
  const outsider = userActor(outsiderUser);
  const admin = userActor(adminUser);
  const made = await execute(ctx, conversationsCreateOp, a, {
    title: "Private",
    recipientIds: [bUser.id, cUser.id, adminUser.id],
    body: "first",
  });
  const id = made.conversation.id;
  const first = made.message.id;
  const reply = (actor: typeof a, body = "reply") =>
    execute(ctx, conversationsReplyOp, actor, { conversationId: id, body });
  const lock = (actor: typeof a, locked: boolean) =>
    execute(ctx, conversationsSetLockedOp, actor, { conversationId: id, locked });
  const list = (actor: typeof a) =>
    execute(ctx, conversationsListMessagesOp, actor, { conversationId: id, limit: 50 });
  const edit = (actor: typeof a, messageId: number, body: string, extra = {}) =>
    execute(ctx, conversationsUpdateMessageOp, actor, { messageId, body, ...extra });
  const remove = (actor: typeof a, messageId: number) =>
    execute(ctx, conversationsDeleteMessageOp, actor, { messageId });
  const row = () =>
    ctx.sqlite
      .prepare<
        {
          message_count: number;
          last_message_id: number;
          last_message_user_id: number;
          last_message_at: number;
        },
        [number]
      >(
        "SELECT message_count, last_message_id, last_message_user_id, last_message_at FROM conversations WHERE id = ?1",
      )
      .get(id)!;
  return {
    ctx,
    aUser,
    bUser,
    cUser,
    adminUser,
    a,
    b,
    c,
    outsider,
    admin,
    id,
    first,
    reply,
    lock,
    list,
    edit,
    remove,
    row,
    made,
  };
}

describe("locking a conversation", () => {
  test("the starter locks and unlocks; the flags follow", async () => {
    const s = await setup();
    expect((await execute(s.ctx, conversationsGetOp, s.a, { conversationId: s.id })).isLocked).toBe(
      false,
    );
    const locked = await s.lock(s.a, true);
    expect([locked.isLocked, locked.canReply, locked.canLock]).toEqual([true, false, true]);
    expect((await s.lock(s.a, false)).isLocked).toBe(false);
  });

  test("a moderator who takes part locks; other participants are refused; outsiders find nothing", async () => {
    const s = await setup();
    expect((await s.lock(s.admin, true)).isLocked).toBe(true);
    await s.lock(s.admin, false);
    await expect(s.lock(s.b, true)).rejects.toThrow(ForbiddenError);
    await expect(s.lock(GUEST, true)).rejects.toThrow(UnauthenticatedError);
    await expect(s.lock(s.outsider, true)).rejects.toThrow(NotFoundError);
    // A moderator who is not a participant cannot even see it.
    const stranger = userActor(insertUser(s.ctx, { groupId: 4 }));
    await expect(s.lock(stranger, true)).rejects.toThrow(NotFoundError);
    expect((await execute(s.ctx, conversationsGetOp, s.b, { conversationId: s.id })).isLocked).toBe(
      false,
    );
  });

  test("abilities per role while open and while locked", async () => {
    const s = await setup();
    const view = async (actor: typeof s.a) =>
      execute(s.ctx, conversationsGetOp, actor, { conversationId: s.id });
    expect(
      await Promise.all(
        [s.a, s.b, s.admin].map(async (x) => [(await view(x)).canReply, (await view(x)).canLock]),
      ),
    ).toEqual([
      [true, true],
      [true, false],
      [true, true],
    ]);
    await s.lock(s.a, true);
    expect(
      await Promise.all(
        [s.a, s.b, s.admin].map(async (x) => [(await view(x)).canReply, (await view(x)).canLock]),
      ),
    ).toEqual([
      [false, true],
      [false, false],
      [true, true],
    ]);
  });

  test("replies are refused while locked except for a moderator; adding and renaming still work", async () => {
    const s = await setup();
    await s.lock(s.a, true);
    await expect(s.reply(s.b)).rejects.toThrow(ForbiddenError);
    await expect(s.reply(s.a)).rejects.toThrow(ForbiddenError);
    const sent = await s.reply(s.admin, "from a moderator");
    expect(sent.state).toBe("visible");
    expect(s.row().message_count).toBe(2);
    const outsiderId = (s.outsider as { userId: number }).userId;
    await execute(s.ctx, getOperation("conversations.addParticipants"), s.a, {
      conversationId: s.id,
      userIds: [outsiderId],
    });
    await execute(s.ctx, getOperation("conversations.rename"), s.a, {
      conversationId: s.id,
      title: "Renamed",
    });
    await s.lock(s.a, false);
    await s.reply(s.b);
  });

  test("a moderator revoked meanwhile cannot reply to or lock a locked conversation", async () => {
    const s = await setup();
    const founder = userActor(insertUser(s.ctx, { groupId: 4 }));
    const group = (await execute(s.ctx, getOperation("groups.create"), founder, {
      title: "Conversation staff",
      rank: 40,
    })) as { id: number };
    await execute(s.ctx, getOperation("permissions.set"), founder, {
      groupId: group.id,
      entries: [
        { permission: "conversation.moderate", value: "allow" },
        { permission: "conversation.receive", value: "allow" },
      ],
    });
    const staff = insertUser(s.ctx, { groupId: group.id });
    await execute(s.ctx, getOperation("conversations.addParticipants"), s.a, {
      conversationId: s.id,
      userIds: [staff.id],
    });
    const others = await s.reply(s.b, "b says");
    await s.lock(s.a, true);
    const database = sharedDatabase(s.ctx);
    try {
      const here = database.open();
      const elsewhere = database.open();
      const actor = resolvedActor(here, staff.id);
      await execute(elsewhere, getOperation("users.setGroups"), founder, {
        userId: staff.id,
        primaryGroupId: 2,
      });
      const before = JSON.stringify(
        elsewhere.sqlite
          .prepare("SELECT id, body_source, state, edited_at FROM conversation_messages")
          .all(),
      );
      await expect(
        execute(here, conversationsReplyOp, actor, { conversationId: s.id, body: "late" }),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        execute(here, conversationsSetLockedOp, actor, { conversationId: s.id, locked: false }),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        execute(here, conversationsUpdateMessageOp, actor, { messageId: s.first, body: "late" }),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        execute(here, conversationsDeleteMessageOp, actor, { messageId: others.id }),
      ).rejects.toThrow(ForbiddenError);
      expect(
        JSON.stringify(
          elsewhere.sqlite
            .prepare("SELECT id, body_source, state, edited_at FROM conversation_messages")
            .all(),
        ),
      ).toBe(before);
      expect(
        elsewhere.sqlite
          .prepare<{ is_locked: number }, [number]>(
            "SELECT is_locked FROM conversations WHERE id = ?1",
          )
          .get(s.id)!.is_locked,
      ).toBe(1);
    } finally {
      database.close();
    }
  });
});

describe("lock bookkeeping", () => {
  const logged = (s: Awaited<ReturnType<typeof setup>>) =>
    s.ctx.sqlite
      .prepare<{ action: string }, []>(
        "SELECT action FROM moderator_log WHERE target_type = 'conversation' ORDER BY id",
      )
      .all()
      .map((r) => r.action);

  test("a moderator locking someone else's conversation is logged; an unchanged state writes nothing", async () => {
    const s = await setup();
    await s.lock(s.a, true);
    expect(logged(s)).toEqual([]);
    await s.lock(s.admin, false);
    await s.lock(s.admin, false);
    await s.lock(s.admin, true);
    expect(logged(s)).toEqual(["conversation.unlock", "conversation.lock"]);
  });

  test("create and reply answer with the abilities the list gives", async () => {
    const s = await setup();
    const sent = await s.reply(s.admin, "from staff");
    expect([sent.canEdit, sent.canDelete]).toEqual([true, true]);
    const listed = (await s.list(s.admin)).items.find((m) => m.id === sent.id)!;
    expect([listed.canEdit, listed.canDelete]).toEqual([sent.canEdit, sent.canDelete]);
    expect([s.made.message.canEdit, s.made.message.canDelete]).toEqual([true, false]);
    const adminMade = await execute(s.ctx, conversationsCreateOp, s.admin, {
      title: "Staff",
      recipientIds: [s.aUser.id],
      body: "hi",
    });
    expect([adminMade.message.canEdit, adminMade.message.canDelete]).toEqual([true, false]);
  });
});

describe("editing a message", () => {
  test("the author edits: body, editedAt, abilities", async () => {
    const s = await setup();
    const sent = await s.reply(s.b, "mine");
    expect(sent.editedAt).toBeNull();
    s.ctx.now = () => Date.parse("2030-01-01T00:00:00Z");
    const edited = await s.edit(s.b, sent.id, "**changed**");
    expect(edited.bodyHtml).toContain("<strong>changed</strong>");
    expect(edited.editedAt).toBe("2030-01-01T00:00:00.000Z");
    const listed = (await s.list(s.b)).items.find((m) => m.id === sent.id)!;
    expect(listed.editedAt).toBe(edited.editedAt);
  });

  test("abilities for each role, open and locked", async () => {
    const s = await setup();
    const mine = await s.reply(s.b, "b says");
    const flags = async (actor: typeof s.a) =>
      (await s.list(actor)).items.map((m) => [
        m.id === s.first ? "first" : "reply",
        m.canEdit,
        m.canDelete,
      ]);
    expect(await flags(s.a)).toEqual([
      ["first", true, false],
      ["reply", false, false],
    ]);
    expect(await flags(s.b)).toEqual([
      ["first", false, false],
      ["reply", true, true],
    ]);
    expect(await flags(s.admin)).toEqual([
      ["first", true, false],
      ["reply", true, true],
    ]);
    expect(mine.canEdit).toBe(true);
    await s.lock(s.a, true);
    expect(await flags(s.a)).toEqual([
      ["first", false, false],
      ["reply", false, false],
    ]);
    expect(await flags(s.b)).toEqual([
      ["first", false, false],
      ["reply", false, false],
    ]);
    expect(await flags(s.admin)).toEqual([
      ["first", true, false],
      ["reply", true, true],
    ]);
  });

  test("a moderator edits another member's message; others are refused", async () => {
    const s = await setup();
    const sent = await s.reply(s.b, "b says");
    expect((await s.edit(s.admin, sent.id, "tidied")).bodyHtml).toContain("tidied");
    await expect(s.edit(s.c, sent.id, "mine now")).rejects.toThrow(ForbiddenError);
    await expect(s.edit(s.outsider, sent.id, "x")).rejects.toThrow(NotFoundError);
    await expect(s.edit(GUEST, sent.id, "x")).rejects.toThrow(UnauthenticatedError);
    await expect(s.edit(s.b, 999999, "x")).rejects.toThrow(NotFoundError);
  });

  test("an author cannot edit while it is locked; a moderator can", async () => {
    const s = await setup();
    const sent = await s.reply(s.b);
    await s.lock(s.a, true);
    await expect(s.edit(s.b, sent.id, "late")).rejects.toThrow(ForbiddenError);
    expect((await s.edit(s.admin, sent.id, "fixed")).bodyHtml).toContain("fixed");
  });

  test("a deleted message answers not found to those who cannot see it, conflict to those who can", async () => {
    const s = await setup();
    const sent = await s.reply(s.b);
    await s.remove(s.b, sent.id);
    await expect(s.edit(s.b, sent.id, "x")).rejects.toThrow(NotFoundError);
    await expect(s.edit(s.admin, sent.id, "x")).rejects.toThrow(ConflictError);
  });

  test("a message held for approval is seen only by its author", async () => {
    const s = await setup();
    const sent = await s.reply(s.b);
    s.ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'moderated' WHERE id = ?1")
      .run(sent.id);
    await expect(s.edit(s.c, sent.id, "x")).rejects.toThrow(NotFoundError);
    expect((await s.edit(s.b, sent.id, "still mine")).state).toBe("moderated");
  });

  test("mentions alert only the newly mentioned, once", async () => {
    const s = await setup();
    registerNotificationJobs(s.ctx);
    const sent = await s.reply(s.b, "no one");
    await dispatchEvents(s.ctx);
    await runDueJobs(s.ctx);
    const mentions = (userId: number) =>
      s.ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM notifications WHERE type = 'content.mentioned' AND user_id = ?1",
        )
        .get(userId)!.n;
    await s.edit(s.b, sent.id, `hello @${s.cUser.username}`);
    await dispatchEvents(s.ctx);
    await runDueJobs(s.ctx);
    expect(mentions(s.cUser.id)).toBe(1);
    await s.edit(s.b, sent.id, `hello again @${s.cUser.username}`);
    await dispatchEvents(s.ctx);
    await runDueJobs(s.ctx);
    expect(mentions(s.cUser.id)).toBe(1);
  });

  test("attachments: omitted keeps them, a list replaces them", async () => {
    const s = await setup();
    const file = () =>
      Number(
        s.ctx.sqlite
          .prepare(
            "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at) VALUES ('fake', ?1, 4, 'text/plain', 'hash', ?2, 'attachment', 'unattached', ?3)",
          )
          .run(crypto.randomUUID(), s.bUser.id, s.ctx.now()).lastInsertRowid,
      );
    const one = file();
    const sent = await execute(s.ctx, conversationsReplyOp, s.b, {
      conversationId: s.id,
      body: "with file",
      attachmentIds: [one],
    });
    expect(sent.attachmentCount).toBe(1);
    expect((await s.edit(s.b, sent.id, "text only")).attachments.map((x) => x.fileId)).toEqual([
      one,
    ]);
    const two = file();
    const replaced = await s.edit(s.b, sent.id, "swapped", { attachmentIds: [two] });
    expect(replaced.attachments.map((x) => x.fileId)).toEqual([two]);
    expect((await s.edit(s.b, sent.id, "none", { attachmentIds: [] })).attachmentCount).toBe(0);
  });
});

describe("deleting a message", () => {
  test("the author deletes a reply; counters and the last message follow", async () => {
    const s = await setup();
    const one = await s.reply(s.b, "one");
    const two = await s.reply(s.c, "two");
    expect(s.row()).toMatchObject({ message_count: 3, last_message_id: two.id });
    expect(await s.remove(s.c, two.id)).toEqual({ ok: true });
    expect(s.row()).toMatchObject({
      message_count: 2,
      last_message_id: one.id,
      last_message_user_id: s.bUser.id,
    });
    const gone = (await s.list(s.admin)).items.find((m) => m.id === two.id)!;
    expect(gone.state).toBe("deleted");
    expect((await s.list(s.b)).items.map((m) => m.id)).toEqual([s.first, one.id]);
    await expect(s.remove(s.c, two.id)).rejects.toThrow(NotFoundError);
    await expect(s.remove(s.admin, two.id)).rejects.toThrow(ConflictError);
  });

  test("a moderator deletes another member's message; others are refused", async () => {
    const s = await setup();
    const sent = await s.reply(s.b);
    await expect(s.remove(s.c, sent.id)).rejects.toThrow(ForbiddenError);
    await expect(s.remove(s.outsider, sent.id)).rejects.toThrow(NotFoundError);
    await expect(s.remove(GUEST, sent.id)).rejects.toThrow(UnauthenticatedError);
    await s.remove(s.admin, sent.id);
    expect(s.row().message_count).toBe(1);
    expect(
      s.ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM moderator_log WHERE target_type = 'conversation_message'",
        )
        .get()!.n,
    ).toBe(1);
  });

  test("the first message cannot be deleted, not even by a moderator", async () => {
    const s = await setup();
    await expect(s.remove(s.a, s.first)).rejects.toThrow(ValidationError);
    await expect(s.remove(s.admin, s.first)).rejects.toThrow(ValidationError);
  });

  test("an author cannot delete while it is locked; a moderator can", async () => {
    const s = await setup();
    const sent = await s.reply(s.b);
    await s.lock(s.a, true);
    await expect(s.remove(s.b, sent.id)).rejects.toThrow(ForbiddenError);
    await s.remove(s.admin, sent.id);
    expect(s.row().message_count).toBe(1);
  });

  test("deleting a message held for approval leaves the visible counters alone", async () => {
    const s = await setup();
    const sent = await s.reply(s.b);
    s.ctx.sqlite
      .prepare("UPDATE conversation_messages SET state = 'moderated' WHERE id = ?1")
      .run(sent.id);
    s.ctx.sqlite
      .prepare("UPDATE conversations SET message_count = 1, last_message_id = ?1 WHERE id = ?2")
      .run(s.first, s.id);
    await s.remove(s.b, sent.id);
    expect(s.row()).toMatchObject({ message_count: 1, last_message_id: s.first });
  });
});

describe("statements", () => {
  test("the new queries use indexes", async () => {
    const s = await setup();
    expectNoTableScan(s.ctx, firstMessageSql, [s.id]);
    expectNoTableScan(s.ctx, messageSql, [s.first]);
  });
});

describe("reading a message's source for editing", () => {
  const source = (s: Awaited<ReturnType<typeof setup>>, actor: typeof s.a, messageId: number) =>
    execute(s.ctx, conversationsGetMessageOp, actor, { messageId });

  test("the author gets the message with its source and abilities", async () => {
    const s = await setup();
    const mine = await s.reply(s.b, "**mine**");
    const got = await source(s, s.b, mine.id);
    expect(got.bodySource).toBe("**mine**");
    expect([got.id, got.conversationId, got.canEdit]).toEqual([mine.id, s.id, true]);
    expect(got.bodyHtml).toContain("<strong>mine</strong>");
  });

  test("a moderator who takes part gets anyone's message", async () => {
    const s = await setup();
    const theirs = await s.reply(s.b, "theirs");
    expect((await source(s, s.admin, theirs.id)).bodySource).toBe("theirs");
  });

  test("another participant, a non-participant and a guest find nothing", async () => {
    const s = await setup();
    const theirs = await s.reply(s.b, "theirs");
    await expect(source(s, s.c, theirs.id)).rejects.toThrow(NotFoundError);
    await expect(source(s, s.outsider, theirs.id)).rejects.toThrow(NotFoundError);
    await expect(source(s, GUEST, theirs.id)).rejects.toThrow(UnauthenticatedError);
    // A moderator who does not take part cannot see the conversation at all.
    const stranger = userActor(insertUser(s.ctx, { groupId: 4 }));
    await expect(source(s, stranger, theirs.id)).rejects.toThrow(NotFoundError);
  });

  test("while the conversation is locked the author finds nothing and the moderator still reads it", async () => {
    const s = await setup();
    const mine = await s.reply(s.b, "mine");
    await s.lock(s.a, true);
    await expect(source(s, s.b, mine.id)).rejects.toThrow(NotFoundError);
    expect((await source(s, s.admin, mine.id)).bodySource).toBe("mine");
  });

  test("a deleted message has no source, not even for the moderator", async () => {
    const s = await setup();
    const gone = await s.reply(s.b, "gone");
    await s.remove(s.admin, gone.id);
    await expect(source(s, s.admin, gone.id)).rejects.toThrow(NotFoundError);
    await expect(source(s, s.b, gone.id)).rejects.toThrow(NotFoundError);
    await expect(source(s, s.admin, 999999)).rejects.toThrow(NotFoundError);
  });
});
