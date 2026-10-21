import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

// One-off for the XenForo import: members who left a conversation choosing to ignore future
// messages (`deleted_ignored` in XenForo) were imported as `left`, which a new reply now undoes.
// This marks them `left_ignored`, so only being added again brings the conversation back.

export type Pair = { conversationId: number; userId: number };

export type Plan = {
  /** Pairs in the file. */
  listed: number;
  /** Pairs whose participant row is `left`: these are marked. */
  toMark: number;
  /** Pairs already `left_ignored`. */
  alreadyIgnored: number;
  /** Pairs whose member is active again (a reply or an addition since): left alone. */
  active: number;
  /** Pairs with no participant row (the conversation or the member was not imported). */
  missing: number;
};

/** `conversation_id,user_id` lines, as `mariadb -B` or a CSV export writes them; one header line is allowed. */
export function parsePairs(text: string): Pair[] {
  const pairs: Pair[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "") continue;
    const [a, b, ...rest] = line.split(/[,;\t]/).map((part) => part.trim().replace(/^"|"$/g, ""));
    const conversationId = Number(a);
    const userId = Number(b);
    if (
      rest.length > 0 ||
      !Number.isSafeInteger(conversationId) ||
      !Number.isSafeInteger(userId) ||
      conversationId < 1 ||
      userId < 1
    ) {
      if (pairs.length === 0 && index === 0 && Number.isNaN(conversationId)) continue;
      throw new Error(`Line ${index + 1} is not "conversation_id,user_id": ${raw}`);
    }
    pairs.push({ conversationId, userId });
  }
  return pairs;
}

const stateSql =
  "SELECT state FROM conversation_participants WHERE conversation_id = ?1 AND user_id = ?2";

export function planIgnoredLeavers(db: Database, pairs: Pair[]): Plan {
  const read = db.prepare<{ state: string }, [number, number]>(stateSql);
  const plan: Plan = { listed: pairs.length, toMark: 0, alreadyIgnored: 0, active: 0, missing: 0 };
  for (const pair of pairs) {
    const state = read.get(pair.conversationId, pair.userId)?.state;
    if (state === "left") plan.toMark++;
    else if (state === "left_ignored") plan.alreadyIgnored++;
    else if (state === "active") plan.active++;
    else plan.missing++;
  }
  return plan;
}

/**
 * Copies the database to `backupPath` (`VACUUM INTO`; refuses a file that exists), then marks the
 * pairs in one transaction, each only while its row is still `left`. Returns the plan and how many
 * rows changed.
 */
export function applyIgnoredLeavers(
  db: Database,
  pairs: Pair[],
  backupPath: string,
): Plan & { marked: number } {
  if (existsSync(backupPath)) throw new Error(`The backup file already exists: ${backupPath}`);
  const plan = planIgnoredLeavers(db, pairs);
  db.run("VACUUM INTO ?1", [backupPath]);
  const mark = db.prepare(
    "UPDATE conversation_participants SET state = 'left_ignored' WHERE conversation_id = ?1 AND user_id = ?2 AND state = 'left'",
  );
  let marked = 0;
  db.transaction(() => {
    for (const pair of pairs) marked += mark.run(pair.conversationId, pair.userId).changes;
  })();
  return { ...plan, marked };
}
