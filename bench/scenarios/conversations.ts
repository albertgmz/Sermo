import type { Scenario } from "../harness";

const cursors = new Map<number, string>();
const deepMessages: { conversationId: number; userId: number; cursor: string }[] = [];
export const scenarios: Scenario[] = [
  {
    name: "conversations.list first page",
    kind: "read",
    run(env, i) {
      const userId = env.meta.busyConversationUserIds[i % env.meta.busyConversationUserIds.length]!;
      return env.call("conversations.list", env.actors.user(userId), { limit: 20 });
    },
  },
  {
    name: "conversations.list deeper page",
    kind: "read",
    async setup(env) {
      for (const userId of env.meta.busyConversationUserIds) {
        let cursor: string | null = null;
        for (let page = 0; page < 3; page++) {
          const value = JSON.parse(
            (await env.call("conversations.list", env.actors.user(userId), {
              limit: 20,
              ...(cursor ? { cursor } : {}),
            })) as string,
          );
          cursor = value.nextCursor;
          if (!cursor) throw new Error(`Busy user ${userId} has fewer than four inbox pages.`);
        }
        if (!cursor) throw new Error(`No deep inbox cursor for user ${userId}.`);
        cursors.set(userId, cursor);
      }
    },
    run(env, i) {
      const userId = env.meta.busyConversationUserIds[i % env.meta.busyConversationUserIds.length]!;
      return env.call("conversations.list", env.actors.user(userId), {
        limit: 20,
        cursor: cursors.get(userId),
      });
    },
  },
  {
    name: "conversations.get",
    kind: "read",
    run(env, i) {
      const [conversationId, userId] =
        env.meta.conversationMembers[i % env.meta.conversationMembers.length]!;
      return env.call("conversations.get", env.actors.user(userId), { conversationId });
    },
  },
  {
    name: "conversations.listMessages",
    kind: "read",
    run(env, i) {
      const [conversationId, userId] =
        env.meta.conversationMembers[i % env.meta.conversationMembers.length]!;
      return env.call("conversations.listMessages", env.actors.user(userId), {
        conversationId,
        limit: 20,
      });
    },
  },
  {
    name: "conversations.listMessages deep page",
    kind: "read",
    async setup(env) {
      const rows = env.ctx.sqlite
        .prepare<{ conversationId: number; userId: number }, []>(
          "SELECT c.id AS conversationId, cp.user_id AS userId FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.state = 'active' WHERE c.message_count >= 500 ORDER BY c.message_count DESC LIMIT 8",
        )
        .all();
      if (!rows.length) throw new Error("No long conversation has an active participant.");
      deepMessages.length = 0;
      for (const row of rows) {
        let cursor: string | null = null;
        for (let page = 0; page < 10; page++) {
          const value = JSON.parse(
            (await env.call("conversations.listMessages", env.actors.user(row.userId), {
              conversationId: row.conversationId,
              limit: 20,
              ...(cursor ? { cursor } : {}),
            })) as string,
          );
          cursor = value.nextCursor;
          if (!cursor)
            throw new Error(`Conversation ${row.conversationId} has fewer than 11 message pages.`);
        }
        if (!cursor)
          throw new Error(`No deep message cursor for conversation ${row.conversationId}.`);
        deepMessages.push({ ...row, cursor });
      }
    },
    run(env, i) {
      const row = deepMessages[i % deepMessages.length]!;
      return env.call("conversations.listMessages", env.actors.user(row.userId), {
        conversationId: row.conversationId,
        limit: 20,
        cursor: row.cursor,
      });
    },
  },
  {
    name: "conversations.create",
    kind: "write",
    run(env, i) {
      const sender = env.meta.memberIds[i % env.meta.memberIds.length]!;
      const recipient = env.meta.memberIds[(i + 1) % env.meta.memberIds.length]!;
      return env.call("conversations.create", env.actors.user(sender), {
        title: "Benchmark conversation",
        recipientIds: [recipient],
        body: "First message",
      });
    },
  },
  {
    name: "conversations.reply",
    kind: "write",
    run(env, i) {
      const [conversationId, userId] =
        env.meta.conversationMembers[i % env.meta.conversationMembers.length]!;
      return env.call("conversations.reply", env.actors.user(userId), {
        conversationId,
        body: "Benchmark reply",
      });
    },
  },
  {
    name: "conversations.markRead",
    kind: "write",
    run(env, i) {
      const [conversationId, userId] =
        env.meta.conversationMembers[i % env.meta.conversationMembers.length]!;
      return env.call("conversations.markRead", env.actors.user(userId), { conversationId });
    },
  },
];

// Own conversations, so locking never touches the ones the other scenarios reply to.
const owned: { conversationId: number; messageId: number; userId: number }[] = [];
async function ownConversations(env: Parameters<NonNullable<Scenario["setup"]>>[0]) {
  if (owned.length) return;
  for (let i = 0; i < 20; i++) {
    const userId = env.meta.memberIds[i % env.meta.memberIds.length]!;
    const recipient = env.meta.memberIds[(i + 1) % env.meta.memberIds.length]!;
    const made = JSON.parse(
      (await env.call("conversations.create", env.actors.user(userId), {
        title: "Benchmark lock and edit",
        recipientIds: [recipient],
        body: "First message",
      })) as string,
    );
    owned.push({ conversationId: made.conversation.id, messageId: made.message.id, userId });
  }
}
scenarios.push(
  {
    name: "conversations.updateMessage",
    kind: "write",
    setup: ownConversations,
    run(env, i) {
      const row = owned[i % owned.length]!;
      return env.call("conversations.updateMessage", env.actors.user(row.userId), {
        messageId: row.messageId,
        body: `Edited ${i}`,
      });
    },
  },
  {
    name: "conversations.setLocked",
    kind: "write",
    setup: ownConversations,
    run(env, i) {
      const row = owned[i % owned.length]!;
      const locked = env.ctx.sqlite
        .prepare<{ is_locked: number }, [number]>(
          "SELECT is_locked FROM conversations WHERE id = ?1",
        )
        .get(row.conversationId)!.is_locked;
      return env.call("conversations.setLocked", env.actors.user(row.userId), {
        conversationId: row.conversationId,
        locked: locked === 0,
      });
    },
  },
);
