import { dispatchEvents, registerNotificationJobs, runDueJobs } from "@sermo/core";
import type { BenchEnv, Scenario } from "../harness";

const RECIPIENTS = 50;
let conversationId = 0;

/** Runs the event fan-out and its jobs until nothing is left to do. */
async function settle(env: BenchEnv): Promise<void> {
  while ((await dispatchEvents(env.ctx)) + (await runDueJobs(env.ctx, { limit: 10 })) > 0)
    await new Promise((resolve) => setImmediate(resolve));
}

export const scenarios: Scenario[] = [
  {
    // A conversation of its own, so no seeded conversation is touched. Each iteration is one
    // reply and the fan-out of its alerts; the burst leaves one unread alert per recipient.
    name: "conversations.reply burst fan-out (50 participants)",
    kind: "write",
    iterations: 5,
    budgetExempt: "notification fan-out",
    async setup(env) {
      registerNotificationJobs(env.ctx);
      // Only the events of this scenario are fanned out, not those other scenarios left behind.
      env.ctx.sqlite
        .prepare(
          "UPDATE event_subscribers SET last_event_id = (SELECT COALESCE(MAX(id), 0) FROM domain_events) WHERE name = 'notifications'",
        )
        .run();
      const made = JSON.parse(
        (await env.call("conversations.create", env.actors.admin, {
          title: "Benchmark burst",
          recipientIds: env.meta.memberIds.slice(0, RECIPIENTS),
          body: "First message",
        })) as string,
      ) as { conversation: { id: number } };
      conversationId = made.conversation.id;
      await settle(env);
    },
    async run(env, i) {
      await env.call("conversations.reply", env.actors.admin, {
        conversationId,
        body: `Burst message ${i}`,
      });
      await settle(env);
    },
    teardown(env) {
      const newest = env.ctx.sqlite
        .prepare<{ id: number }, [number]>(
          "SELECT max(id) AS id FROM conversation_messages WHERE conversation_id = ?1",
        )
        .get(conversationId)!.id;
      // Every recipient has one unread alert, and it points at the newest message.
      const alerts = env.ctx.sqlite
        .prepare<{ n: number; members: number }, [number]>(
          "SELECT count(*) AS n, count(DISTINCT user_id) AS members FROM notifications WHERE content_type = 'conversation_message' AND content_id = ?1 AND type = 'conversation.message' AND read_at IS NULL",
        )
        .get(newest)!;
      if (alerts.n !== RECIPIENTS || alerts.members !== RECIPIENTS)
        throw new Error(
          `The burst left ${alerts.n} alerts at its newest message for ${alerts.members} members, not one each for ${RECIPIENTS}.`,
        );
    },
  },
];
