import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext, insertUser } from "@sermo/core/testing";
import { applyIgnoredLeavers, parsePairs, planIgnoredLeavers } from "./ignored-leavers-lib";

const scratch = mkdtempSync(join(tmpdir(), "sermo-leavers-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function fixture() {
  const ctx = createTestContext();
  const users = [insertUser(ctx), insertUser(ctx), insertUser(ctx), insertUser(ctx)];
  ctx.sqlite
    .prepare(
      "INSERT INTO conversations (id, title, user_id, created_at, last_message_at, last_message_user_id) VALUES (7, 'T', ?1, 1, 1, ?1)",
    )
    .run(users[0]!.id);
  const add = (userId: number, state: string) =>
    ctx.sqlite
      .prepare(
        "INSERT INTO conversation_participants (conversation_id, user_id, state, joined_at, last_message_at) VALUES (7, ?1, ?2, 1, 1)",
      )
      .run(userId, state);
  add(users[0]!.id, "active");
  add(users[1]!.id, "left");
  add(users[2]!.id, "left_ignored");
  add(users[3]!.id, "left");
  const stateOf = (userId: number) =>
    ctx.sqlite
      .prepare<{ state: string }, [number]>(
        "SELECT state FROM conversation_participants WHERE conversation_id = 7 AND user_id = ?1",
      )
      .get(userId)!.state;
  return { ctx, users, stateOf };
}

describe("reading the pairs", () => {
  test("lines of conversation and member, with an optional header, blanks and quotes", () => {
    expect(parsePairs('conversation_id\tuser_id\n7\t3\n\n"8","4"\r\n9,5\n')).toEqual([
      { conversationId: 7, userId: 3 },
      { conversationId: 8, userId: 4 },
      { conversationId: 9, userId: 5 },
    ]);
  });

  test("a line that is not a pair of ids is refused, naming the line", () => {
    expect(() => parsePairs("7,3\nseven,3\n")).toThrow("Line 2");
    expect(() => parsePairs("7,3,9\n")).toThrow("Line 1");
    expect(() => parsePairs("7,0\n")).toThrow("Line 1");
  });
});

describe("marking", () => {
  test("a dry run counts what would change and writes nothing", () => {
    const { ctx, users, stateOf } = fixture();
    const pairs = [
      { conversationId: 7, userId: users[1]!.id },
      { conversationId: 7, userId: users[2]!.id },
      { conversationId: 7, userId: users[0]!.id },
      { conversationId: 99, userId: users[1]!.id },
    ];
    expect(planIgnoredLeavers(ctx.sqlite, pairs)).toEqual({
      listed: 4,
      toMark: 1,
      alreadyIgnored: 1,
      active: 1,
      missing: 1,
    });
    expect(stateOf(users[1]!.id)).toBe("left");
  });

  test("applying backs the database up first, then marks only rows still left", () => {
    const { ctx, users, stateOf } = fixture();
    const pairs = [
      { conversationId: 7, userId: users[1]!.id },
      { conversationId: 7, userId: users[0]!.id },
    ];
    const backup = join(scratch, "before.db");
    const result = applyIgnoredLeavers(ctx.sqlite, pairs, backup);
    expect(result).toMatchObject({ toMark: 1, active: 1, marked: 1 });
    expect(stateOf(users[1]!.id)).toBe("left_ignored");
    expect(stateOf(users[0]!.id)).toBe("active");
    expect(stateOf(users[3]!.id)).toBe("left");
    // The backup holds the rows as they were.
    expect(existsSync(backup)).toBe(true);
    const saved = new Database(backup, { readonly: true });
    expect(
      saved
        .query<{ state: string }, [number]>(
          "SELECT state FROM conversation_participants WHERE conversation_id = 7 AND user_id = ?1",
        )
        .get(users[1]!.id)?.state,
    ).toBe("left");
    saved.close();
    // A second run finds nothing left to mark and refuses to overwrite the backup.
    expect(() => applyIgnoredLeavers(ctx.sqlite, pairs, backup)).toThrow("already exists");
    expect(applyIgnoredLeavers(ctx.sqlite, pairs, join(scratch, "again.db")).marked).toBe(0);
  });
});
