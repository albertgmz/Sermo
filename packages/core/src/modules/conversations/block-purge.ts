import { type Ctx, prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { registerJobHandler } from "../jobs/queue";
import { purgeContent, purgeConversationShell } from "../purge/purge";

const DAY_MS = 86_400_000;
/** A private conversation hidden from both members by a block is deleted this many days later. */
export const BLOCK_PURGE_DAYS = 90;
/** Messages deleted per transaction: short enough that requests never wait on the write lock. */
export const BLOCK_PURGE_BATCH = 200;

export const blockPurgeSql = {
  // The oldest hidden conversation past the cutoff, from `conversations_hidden`, that holds no
  // message under an open report: the evidence stays until the report is closed.
  due:
    "SELECT c.id FROM conversations c WHERE c.hidden_at IS NOT NULL AND c.hidden_at <= ?1 " +
    "AND NOT EXISTS (SELECT 1 FROM conversation_messages m JOIN report_groups g ON g.target_type = 'conversation_message' AND g.target_id = m.id " +
    "WHERE m.conversation_id = c.id AND g.state IN ('open', 'assigned')) ORDER BY c.hidden_at LIMIT 1",
  messages: "SELECT id FROM conversation_messages WHERE conversation_id = ?1 ORDER BY id LIMIT ?2",
} as const;

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Deletes the private conversations a block hid from both members `BLOCK_PURGE_DAYS` ago or more,
 * except one with a message under an open report (kept until a later run finds the report
 * closed), `BLOCK_PURGE_BATCH` messages at a time, one short transaction each, yielding between them; the
 * transaction that removes a conversation's last messages removes the conversation too. Safe to
 * run again after a stop: each transaction leaves the data whole. Returns how many conversations
 * went.
 */
export async function purgeBlockedConversations(ctx: Ctx): Promise<number> {
  const cutoff = ctx.now() - BLOCK_PURGE_DAYS * DAY_MS;
  const due = prepared(ctx, "conversations.blockPurgeDue", () =>
    ctx.sqlite.prepare<{ id: number }, [number]>(blockPurgeSql.due),
  );
  const messages = prepared(ctx, "conversations.blockPurgeMessages", () =>
    ctx.sqlite.prepare<{ id: number }, [number, number]>(blockPurgeSql.messages),
  );
  let removed = 0;
  while (true) {
    const done = writeTx(ctx, () => {
      const conversation = due.get(cutoff);
      if (!conversation) return null;
      const ids = messages.all(conversation.id, BLOCK_PURGE_BATCH).map((row) => row.id);
      purgeContent(ctx, "conversation_message", ids);
      if (ids.length === BLOCK_PURGE_BATCH) return false;
      purgeConversationShell(ctx, conversation.id);
      return true;
    });
    if (done === null) return removed;
    if (done) removed++;
    await yieldToEventLoop();
  }
}

/** The daily job (`runDailyTasks` queues it). */
export function registerBlockPurgeJob(ctx: Ctx): void {
  registerJobHandler(ctx, "conversations.blockPurge", async (context) => {
    await purgeBlockedConversations(context);
  });
}
