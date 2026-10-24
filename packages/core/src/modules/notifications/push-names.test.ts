import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { execute } from "../../operation";
import { renderPlainText } from "../../render";
import { conversationsCreateOp, conversationsLeaveOp } from "../conversations";
import { postsCreateOp, threadsCreateOp } from "../forums";
import { profileCommentsCreateOp, profilePostsCreateOp } from "../profiles";
import { notificationPushPhrase } from "./index";

type Member = ReturnType<typeof insertUser>;
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});

/** Real content owned by named members; the recipient is a separate member. */
async function fixture() {
  const ctx = createTestContext();
  cleanup.push(() => ctx.sqlite.close(true));
  const named = (username: string) => insertUser(ctx, { username });
  const people = {
    recipient: named("Lucia"),
    fulano: named("Fulano"),
    menganito: named("Menganito"),
    zutano: named("Zutano"),
    perengano: named("Perengano"),
  };
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const thread = await execute(ctx, threadsCreateOp, userActor(people.fulano), {
    nodeId: node.id,
    title: "Topic",
    body: "Opening",
  });
  const reply = await execute(ctx, postsCreateOp, userActor(people.zutano), {
    threadId: thread.thread.id,
    body: "A reply",
  });
  const conversation = await execute(ctx, conversationsCreateOp, userActor(people.fulano), {
    title: "Plans",
    recipientIds: [people.recipient.id],
    body: "Saturday?",
  });
  const wallOfOther = await execute(ctx, profilePostsCreateOp, userActor(people.fulano), {
    userId: people.menganito.id,
    body: "On another wall",
  });
  const wallOfRecipient = await execute(ctx, profilePostsCreateOp, userActor(people.fulano), {
    userId: people.recipient.id,
    body: "On your wall",
  });
  const commentOnOther = await execute(ctx, profileCommentsCreateOp, userActor(people.zutano), {
    profilePostId: wallOfOther.id,
    body: "A comment",
  });
  const commentOnOwn = await execute(ctx, profileCommentsCreateOp, userActor(people.zutano), {
    profilePostId: wallOfRecipient.id,
    body: "A comment",
  });
  return {
    ctx,
    ...people,
    threadId: thread.thread.id,
    firstPostId: thread.post.id,
    replyId: reply.id,
    conversationId: conversation.conversation.id,
    messageId: conversation.message.id,
    wallOfOther: wallOfOther.id,
    wallOfRecipient: wallOfRecipient.id,
    commentOnOther: commentOnOther.id,
    commentOnOwn: commentOnOwn.id,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Writes the notice the recipient would hold and renders its push text as the push job does. */
function render(
  f: Fixture,
  language: "en" | "es",
  notice: {
    type: string;
    contentType: string;
    contentId: number;
    threadId?: number;
    actors: Member[];
    userId?: number;
  },
) {
  const userId = notice.userId ?? f.recipient.id;
  const now = f.ctx.now();
  const id = Number(
    f.ctx.sqlite
      .prepare(
        "INSERT INTO notifications (user_id, type, content_type, content_id, thread_id, actor_id, actor_count, actor_ids, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
      )
      .run(
        userId,
        notice.type,
        notice.contentType,
        notice.contentId,
        notice.threadId ?? null,
        notice.actors[0]?.id ?? null,
        notice.actors.length,
        JSON.stringify(notice.actors.map((actor) => actor.id)),
        now,
      ).lastInsertRowid,
  );
  const { bodyHtml } = notificationPushPhrase(f.ctx)(
    {
      notificationId: id,
      userId,
      type: notice.type,
      contentType: notice.contentType,
      contentId: notice.contentId,
      threadId: notice.threadId ?? null,
      actorId: notice.actors[0]?.id ?? null,
      data: {},
    },
    language,
  );
  // The text the device shows: the push payload turns the escaped body into plain text.
  return renderPlainText(bodyHtml, 180);
}

type Case = [
  label: string,
  notice: (f: Fixture) => Parameters<typeof render>[2],
  en: string,
  es: string,
];

const cases: Case[] = [
  [
    "a reply in a watched thread",
    (f) => ({
      type: "thread.watched",
      contentType: "post",
      contentId: f.replyId,
      threadId: f.threadId,
      actors: [f.fulano],
    }),
    "Fulano replied in the thread «Topic».",
    "Fulano respondió en el tema «Topic».",
  ],
  [
    "several repliers in a watched thread",
    (f) => ({
      type: "thread.watched",
      contentType: "post",
      contentId: f.replyId,
      threadId: f.threadId,
      actors: [f.fulano, f.zutano, f.perengano],
    }),
    "Fulano and 2 others replied in the thread «Topic».",
    "Fulano y 2 más respondieron en el tema «Topic».",
  ],
  [
    "two repliers in a watched thread",
    (f) => ({
      type: "thread.watched",
      contentType: "post",
      contentId: f.replyId,
      threadId: f.threadId,
      actors: [f.fulano, f.zutano],
    }),
    "Fulano and 1 other replied in the thread «Topic».",
    "Fulano y 1 más respondieron en el tema «Topic».",
  ],
  [
    "a new thread in a followed forum",
    (f) => ({
      type: "node.thread",
      contentType: "thread",
      contentId: f.threadId,
      threadId: f.threadId,
      actors: [f.fulano],
    }),
    "Fulano started the thread «Topic».",
    "Fulano inició el tema «Topic».",
  ],
  [
    "a new post in a followed forum",
    (f) => ({
      type: "node.post",
      contentType: "post",
      contentId: f.replyId,
      threadId: f.threadId,
      actors: [f.zutano],
    }),
    "Zutano replied in the thread «Topic».",
    "Zutano respondió en el tema «Topic».",
  ],
  [
    "a new thread by a followed member",
    (f) => ({
      type: "member.thread",
      contentType: "thread",
      contentId: f.threadId,
      threadId: f.threadId,
      actors: [f.fulano],
    }),
    "Fulano started the thread «Topic».",
    "Fulano inició el tema «Topic».",
  ],
  [
    "a quote in a thread",
    (f) => ({
      type: "content.quoted",
      contentType: "post",
      contentId: f.replyId,
      threadId: f.threadId,
      actors: [f.zutano],
    }),
    "Zutano quoted your post in the thread «Topic».",
    "Zutano citó tu mensaje en el tema «Topic».",
  ],
  [
    "a quote in a direct message",
    (f) => ({
      type: "content.quoted",
      contentType: "conversation_message",
      contentId: f.messageId,
      actors: [f.fulano],
    }),
    "Fulano quoted your message in the direct message «Plans».",
    "Fulano citó tu mensaje en el mensaje directo «Plans».",
  ],
  [
    "a quote in a wall post on another profile",
    (f) => ({
      type: "content.quoted",
      contentType: "profile_post",
      contentId: f.wallOfOther,
      actors: [f.fulano],
    }),
    "Fulano quoted your post on Menganito's profile.",
    "Fulano citó tu mensaje en el perfil de Menganito.",
  ],
  [
    "a quote in a comment on your profile",
    (f) => ({
      type: "content.quoted",
      contentType: "profile_post_comment",
      contentId: f.commentOnOwn,
      actors: [f.zutano],
    }),
    "Zutano quoted your comment on your profile.",
    "Zutano citó tu comentario en tu perfil.",
  ],
  [
    "a mention in a thread",
    (f) => ({
      type: "content.mentioned",
      contentType: "post",
      contentId: f.replyId,
      threadId: f.threadId,
      actors: [f.zutano],
    }),
    "Zutano mentioned you in the thread «Topic».",
    "Zutano te mencionó en el tema «Topic».",
  ],
  [
    "a mention in a direct message",
    (f) => ({
      type: "content.mentioned",
      contentType: "conversation_message",
      contentId: f.messageId,
      actors: [f.fulano],
    }),
    "Fulano mentioned you in the direct message «Plans».",
    "Fulano te mencionó en el mensaje directo «Plans».",
  ],
  [
    "a mention on another member's profile",
    (f) => ({
      type: "content.mentioned",
      contentType: "profile_post",
      contentId: f.wallOfOther,
      actors: [f.fulano],
    }),
    "Fulano mentioned you on Menganito's profile.",
    "Fulano te mencionó en el perfil de Menganito.",
  ],
  [
    "a mention on your own profile",
    (f) => ({
      type: "content.mentioned",
      contentType: "profile_post",
      contentId: f.wallOfRecipient,
      actors: [f.fulano],
    }),
    "Fulano mentioned you on your profile.",
    "Fulano te mencionó en tu perfil.",
  ],
  [
    "a mention in a comment on another profile",
    (f) => ({
      type: "content.mentioned",
      contentType: "profile_post_comment",
      contentId: f.commentOnOther,
      actors: [f.zutano],
    }),
    "Zutano mentioned you in a comment on Menganito's profile.",
    "Zutano te mencionó en un comentario en el perfil de Menganito.",
  ],
  [
    "reactions to a post",
    (f) => ({
      type: "content.reaction",
      contentType: "post",
      contentId: f.replyId,
      threadId: f.threadId,
      actors: [f.fulano, f.perengano, f.menganito],
    }),
    "Fulano and 2 others reacted to your post in the thread «Topic».",
    "Fulano y 2 más reaccionaron a tu mensaje en el tema «Topic».",
  ],
  [
    "a reaction to a post",
    (f) => ({
      type: "content.reaction",
      contentType: "post",
      contentId: f.replyId,
      threadId: f.threadId,
      actors: [f.fulano],
    }),
    "Fulano reacted to your post in the thread «Topic».",
    "Fulano reaccionó a tu mensaje en el tema «Topic».",
  ],
  [
    "a reaction to a direct message",
    (f) => ({
      type: "content.reaction",
      contentType: "conversation_message",
      contentId: f.messageId,
      actors: [f.fulano],
    }),
    "Fulano reacted to your message in the direct message «Plans».",
    "Fulano reaccionó a tu mensaje en el mensaje directo «Plans».",
  ],
  [
    "a reaction to a wall post on your profile",
    (f) => ({
      type: "content.reaction",
      contentType: "profile_post",
      contentId: f.wallOfRecipient,
      actors: [f.zutano],
    }),
    "Zutano reacted to your post on your profile.",
    "Zutano reaccionó a tu mensaje en tu perfil.",
  ],
  [
    "a reaction to a comment on another profile",
    (f) => ({
      type: "content.reaction",
      contentType: "profile_post_comment",
      contentId: f.commentOnOther,
      actors: [f.fulano],
    }),
    "Fulano reacted to your comment on Menganito's profile.",
    "Fulano reaccionó a tu comentario en el perfil de Menganito.",
  ],
  [
    "a wall post on your profile",
    (f) => ({
      type: "profile.post",
      contentType: "profile_post",
      contentId: f.wallOfRecipient,
      actors: [f.fulano],
    }),
    "Fulano wrote on your profile.",
    "Fulano escribió en tu perfil.",
  ],
  [
    "a comment on your wall post on your own profile",
    (f) => ({
      type: "profile.comment",
      contentType: "profile_post_comment",
      contentId: f.commentOnOwn,
      actors: [f.zutano],
    }),
    "Zutano commented on your post on your profile.",
    "Zutano comentó tu mensaje en tu perfil.",
  ],
  [
    "a comment on your wall post on another profile",
    (f) => ({
      type: "profile.comment",
      contentType: "profile_post_comment",
      contentId: f.commentOnOther,
      actors: [f.zutano],
    }),
    "Zutano commented on your post on Menganito's profile.",
    "Zutano comentó tu mensaje en el perfil de Menganito.",
  ],
  [
    "another comment on a wall post you commented on",
    (f) => ({
      type: "profile.commented",
      contentType: "profile_post_comment",
      contentId: f.commentOnOther,
      actors: [f.zutano],
    }),
    "Zutano also commented on Fulano's profile post.",
    "Zutano también comentó en el mensaje de perfil de Fulano.",
  ],
  [
    "a new follower",
    (f) => ({
      type: "member.followed",
      contentType: "user",
      contentId: 0,
      actors: [f.perengano],
    }),
    "Perengano is now following you.",
    "Perengano te está siguiendo.",
  ],
  [
    "being added to a direct message",
    (f) => ({
      type: "conversation.added",
      contentType: "conversation",
      contentId: f.conversationId,
      actors: [f.fulano],
    }),
    "Fulano added you to the direct message «Plans».",
    "Fulano te agregó al mensaje directo «Plans».",
  ],
  [
    "a reply in a direct message",
    (f) => ({
      type: "conversation.message",
      contentType: "conversation_message",
      contentId: f.messageId,
      actors: [f.fulano],
    }),
    "Fulano replied to the direct message «Plans».",
    "Fulano respondió al mensaje directo «Plans».",
  ],
  [
    "several repliers in a direct message",
    (f) => ({
      type: "conversation.message",
      contentType: "conversation_message",
      contentId: f.messageId,
      actors: [f.fulano, f.zutano],
    }),
    "Fulano and 1 other replied to the direct message «Plans».",
    "Fulano y 1 más respondieron al mensaje directo «Plans».",
  ],
];

describe("push text names the member and the place", () => {
  for (const [label, notice, en, es] of cases)
    test(`${label}, in English and Spanish`, async () => {
      const f = await fixture();
      expect(render(f, "en", notice(f))).toBe(en);
      expect(render(f, "es", notice(f))).toBe(es);
    });

  test("a direct message title is not given to a member who is not in the conversation", async () => {
    const f = await fixture();
    await execute(f.ctx, conversationsLeaveOp, userActor(f.recipient), {
      conversationId: f.conversationId,
    });
    const body = render(f, "en", {
      type: "conversation.message",
      contentType: "conversation_message",
      contentId: f.messageId,
      actors: [f.fulano],
    });
    expect(body).not.toContain("Plans");
    expect(body).toBe("A member wrote in one of your direct messages.");
  });

  test("a direct message title is not given to a member who left, in Spanish too", async () => {
    const f = await fixture();
    await execute(f.ctx, conversationsLeaveOp, userActor(f.recipient), {
      conversationId: f.conversationId,
    });
    const body = render(f, "es", {
      type: "conversation.added",
      contentType: "conversation",
      contentId: f.conversationId,
      actors: [f.fulano],
    });
    expect(body).not.toContain("Plans");
    expect(body).toBe("Te añadieron a un mensaje directo.");
  });

  test("a thread that is gone keeps the generic text and names no title, in English and Spanish", async () => {
    const f = await fixture();
    const gone = { type: "node.post", contentType: "post", contentId: 999_999, threadId: 999_999 };
    const notice = { ...gone, actors: [f.zutano] };
    expect(render(f, "en", notice)).toBe("There is a new post in a forum you follow, in .");
    expect(render(f, "es", notice)).toBe("Hay una publicación nueva en un foro que sigues, en .");
  });

  test("a wall post that is gone keeps the generic text and names no wall owner, in English and Spanish", async () => {
    const f = await fixture();
    const notice = {
      type: "content.mentioned",
      contentType: "profile_post",
      contentId: 999_999,
      actors: [f.fulano],
    };
    expect(render(f, "en", notice)).toBe("A member mentioned you.");
    expect(render(f, "es", notice)).toBe("Un miembro te mencionó.");
  });

  test("a notice without a member behind it keeps its generic text", async () => {
    const f = await fixture();
    expect(
      render(f, "en", {
        type: "content.mentioned",
        contentType: "post",
        contentId: f.replyId,
        threadId: f.threadId,
        actors: [],
      }),
    ).toBe("A member mentioned you.");
  });

  test("a member's name with markup characters reaches the device as plain text", async () => {
    const f = await fixture();
    const odd = insertUser(f.ctx, { username: "A<b>&Co" });
    expect(
      render(f, "en", {
        type: "node.post",
        contentType: "post",
        contentId: f.replyId,
        threadId: f.threadId,
        actors: [odd],
      }),
    ).toBe("A<b>&Co replied in the thread «Topic».");
  });
});
