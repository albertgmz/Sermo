import type { Scenario } from "../harness";

const cursors = new Map<number, string>();
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
          if (!cursor) break;
        }
        if (cursor) cursors.set(userId, cursor);
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
