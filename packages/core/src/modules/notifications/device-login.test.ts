import { expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import type { Actor } from "../../actor";
import { ForbiddenError } from "../../errors";
import { dispatchEvents } from "../../events";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor } from "../../permissions/test-contexts";
import { runDueJobs } from "../jobs";
import { registerNotificationJobs } from "./delivery";

/*
 * A device login (a terminal client's token) sees a moderator's alerts as a member would: no staff
 * notices, no announcement to a staff group, and a count and a page total that match its list.
 */

const asTerminal = (actor: Actor) =>
  ({ ...actor, kind: "token", tokenId: 0, terminalSessionId: 9 }) as Actor;
const run = (ctx: ReturnType<typeof createTestContext>, name: string, actor: Actor, input = {}) =>
  // biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
  execute(ctx, getOperation(name), actor, input) as Promise<any>;

async function world() {
  const ctx = createTestContext();
  registerNotificationJobs(ctx);
  const admin = insertUser(ctx, { groupId: 4 });
  const moderator = insertUser(ctx, { groupId: 3 });
  const send = async (title: string, audience: object) => {
    await run(ctx, "announcements.create", userActor(admin), { title, body: "Words", audience });
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
  };
  await send("Staff announcement", { kind: "group", groupId: 3 });
  await send("Everyone announcement", { kind: "all" });
  ctx.sqlite.run(
    "INSERT INTO notifications (user_id, type, content_type, content_id, created_at, updated_at) VALUES (?1, 'moderator.report', 'user', ?1, 1, 1)",
    [moderator.id],
  );
  ctx.sqlite.run(
    "UPDATE users SET unread_notification_count = unread_notification_count + 1 WHERE id = ?1",
    [moderator.id],
  );
  const browser = resolvedActor(ctx, moderator.id);
  return { ctx, browser, terminal: asTerminal(browser) };
}

test("an announcement to a staff group and the staff notices are not listed or counted for a device login", async () => {
  const { ctx, browser, terminal } = await world();
  const list = (actor: Actor) => run(ctx, "notifications.list", actor, { page: 1, limit: 20 });
  const seen = await list(browser);
  expect(seen.items).toHaveLength(3);
  expect(seen.unreadCount).toBe(3);
  expect(seen.total).toBe(3);
  const token = await list(terminal);
  expect(token.items.map((item: { contentTitle: string }) => item.contentTitle)).toEqual([
    "Everyone announcement",
  ]);
  expect(token.unreadCount).toBe(1);
  expect(token.total).toBe(1);
  const unread = await run(ctx, "notifications.list", terminal, { page: 1, unreadOnly: true });
  expect(unread.total).toBe(1);
  expect((await run(ctx, "auth.counters", terminal)).notifications).toBe(1);
  expect((await run(ctx, "auth.counters", browser)).notifications).toBe(3);
});

test("a device login cannot change how the staff alerts are sent, and can change the others", async () => {
  const { ctx, browser, terminal } = await world();
  const set = (actor: Actor, type: string) =>
    run(ctx, "notifications.setPreferences", actor, { items: [{ type, inApp: false }] });
  await expect(set(terminal, "moderator.report")).rejects.toBeInstanceOf(ForbiddenError);
  await set(terminal, "member.followed");
  await set(browser, "moderator.report");
});
