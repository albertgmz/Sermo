import { type Ctx, prepared } from "../../context";
import { memberHolds, messageBlockSides } from "../social/blocks";

/**
 * What a block does to conversations. A new block hides the private conversations only its two
 * members share (participant state `blocked`, for good); in a group conversation, a message one
 * of them sends while the block stands is hidden from the other (a `conversation_message_hides`
 * row, kept after an unblock). Staff blocked by a member keep seeing that member, and a member
 * with `conversation.alwaysInvite` still reaches a member who blocked them. A block converted
 * from the old ignore list hides no message (`hides_conversations` false).
 */
export const conversationBlockSql = {
  hidden:
    "SELECT message_id FROM conversation_message_hides WHERE user_id = ?1 AND message_id IN (SELECT value FROM json_each(?2))",
  hide: "INSERT OR IGNORE INTO conversation_message_hides (message_id, user_id) SELECT ?1, value FROM json_each(?2)",
  hideHistory:
    "INSERT OR IGNORE INTO conversation_message_hides (message_id, user_id) SELECT id, ?3 FROM conversation_messages WHERE conversation_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
  participants: "SELECT user_id FROM conversation_participants WHERE conversation_id = ?1",
  // The hidden reader stays where they were: no new activity, and still caught up if they were.
  keepReader:
    "UPDATE conversation_participants SET last_message_at = ?2, last_read_message_id = CASE WHEN last_read_message_id >= ?3 THEN ?4 ELSE last_read_message_id END WHERE conversation_id = ?1 AND user_id IN (SELECT value FROM json_each(?5))",
  newestSeen:
    "SELECT id, user_id, created_at FROM conversation_messages m WHERE conversation_id = ?1 AND state = 'visible' AND NOT EXISTS (SELECT 1 FROM conversation_message_hides h WHERE h.message_id = m.id AND h.user_id = ?2) ORDER BY id DESC LIMIT 1",
  // Conversations whose every participant, whatever their state, is one of the two members.
  privateOfPair:
    "SELECT p.conversation_id FROM conversation_participants p WHERE p.user_id = ?1 " +
    "AND EXISTS (SELECT 1 FROM conversation_participants q WHERE q.conversation_id = p.conversation_id AND q.user_id = ?2) " +
    "AND NOT EXISTS (SELECT 1 FROM conversation_participants r WHERE r.conversation_id = p.conversation_id AND r.user_id NOT IN (?1, ?2))",
  hideActive:
    "UPDATE conversation_participants SET state = 'blocked' WHERE conversation_id = ?1 AND user_id = ?2 AND state = 'active'",
  hideOther:
    "UPDATE conversation_participants SET state = 'blocked' WHERE conversation_id = ?1 AND user_id = ?2 AND state != 'blocked'",
  leaveCount: "UPDATE conversations SET participant_count = participant_count - ?1 WHERE id = ?2",
  markHidden: "UPDATE conversations SET hidden_at = ?1 WHERE id = ?2 AND hidden_at IS NULL",
} as const;

function statement<Row = unknown, Params extends (string | number)[] = (string | number)[]>(
  ctx: Ctx,
  key: keyof typeof conversationBlockSql,
) {
  return prepared(ctx, `conversations.blocks.${key}`, () =>
    ctx.sqlite.prepare<Row, Params>(conversationBlockSql[key]),
  );
}

/** Which of `ids` (messages) a block hides from the member. One query. */
export function hiddenMessages(ctx: Ctx, userId: number, ids: number[]): Set<number> {
  if (ids.length === 0) return new Set();
  return new Set(
    statement<{ message_id: number }, [number, string]>(ctx, "hidden")
      .all(userId, JSON.stringify(ids))
      .map((row) => row.message_id),
  );
}

/**
 * The participants a message by `authorId` is hidden from: those who blocked the author (unless
 * the author reaches them anyway, `conversation.alwaysInvite`) and those the author blocked
 * (unless they are staff). Inside the write transaction of the message.
 */
function readersHiddenFrom(
  ctx: Ctx,
  authorId: number,
  authorReaches: boolean,
  participantIds: number[],
): number[] {
  const { mine, theirs } = messageBlockSides(ctx, authorId, participantIds);
  const hidden = new Set(authorReaches ? [] : theirs);
  for (const id of mine) if (!memberHolds(ctx, id, "moderation.access")) hidden.add(id);
  return [...hidden];
}

/**
 * Hides a new message from the participants in a block with its author. When the message became
 * the newest one (`previous` holds the conversation's last message before it), those readers keep
 * their place in the inbox and stay caught up if they were. Inside the message's transaction.
 */
export function hideNewMessage(
  ctx: Ctx,
  message: { id: number; conversationId: number; authorId: number; authorReaches: boolean },
  previous: { at: number; id: number } | null,
): void {
  const others = statement<{ user_id: number }, [number]>(ctx, "participants")
    .all(message.conversationId)
    .map((row) => row.user_id)
    .filter((id) => id !== message.authorId);
  const hidden = readersHiddenFrom(ctx, message.authorId, message.authorReaches, others);
  if (hidden.length === 0) return;
  const ids = JSON.stringify(hidden);
  statement(ctx, "hide").run(message.id, ids);
  if (previous)
    statement(ctx, "keepReader").run(
      message.conversationId,
      previous.at,
      previous.id,
      message.id,
      ids,
    );
}

/**
 * A member added to a group conversation does not see the messages of the participants in a block
 * with them (messages of a participant who may always invite still reach a member who blocked
 * them). Inside the transaction that adds the member.
 */
export function hideHistoryFromAdded(ctx: Ctx, conversationId: number, memberId: number): void {
  const others = statement<{ user_id: number }, [number]>(ctx, "participants")
    .all(conversationId)
    .map((row) => row.user_id)
    .filter((id) => id !== memberId);
  const { mine, theirs } = messageBlockSides(ctx, memberId, others);
  const authors = new Set(memberHolds(ctx, memberId, "moderation.access") ? [] : theirs);
  for (const id of mine) if (!memberHolds(ctx, id, "conversation.alwaysInvite")) authors.add(id);
  if (authors.size > 0)
    statement(ctx, "hideHistory").run(conversationId, JSON.stringify([...authors]), memberId);
}

/**
 * Hides the private conversations of two members when one blocks the other: from the blocker
 * always, and from the blocked member unless they are staff. A conversation hidden from both is
 * marked for the purge. Inside the transaction that adds the block.
 */
export function hidePrivateConversations(ctx: Ctx, blockerId: number, blockedId: number): void {
  const ids = statement<{ conversation_id: number }, [number, number]>(ctx, "privateOfPair")
    .all(blockerId, blockedId)
    .map((row) => row.conversation_id);
  if (ids.length === 0) return;
  const members = memberHolds(ctx, blockedId, "moderation.access")
    ? [blockerId]
    : [blockerId, blockedId];
  for (const id of ids) {
    let left = 0;
    for (const member of members) {
      const active = statement(ctx, "hideActive").run(id, member).changes;
      left += active;
      if (!active) statement(ctx, "hideOther").run(id, member);
    }
    if (left) statement(ctx, "leaveCount").run(left, id);
    if (members.length === 2) statement(ctx, "markHidden").run(ctx.now(), id);
  }
}
