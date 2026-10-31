import { afterEach, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser } from "@sermo/core/testing";
import type { Actor } from "../actor";
import { closeContext, invalidate } from "../context";
import { readSiteSettings } from "../modules/settings";
import { execute } from "../operation";
import { getOperation } from "../operations";
import { resolvedActor } from "../permissions/test-contexts";

/*
 * A device login is not in the member's staff groups for the criteria engine either: notices,
 * widgets and exemptions aimed at staff groups are not its.
 */

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

// biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
const run = (
  ctx: ReturnType<typeof createTestContext>,
  name: string,
  actor: Actor,
  input = {},
): Promise<any> => execute(ctx, getOperation(name), actor, input);

const asTerminal = (actor: Actor) =>
  ({ ...actor, kind: "token", tokenId: 0, terminalSessionId: 9 }) as Actor;
const rule = (...conditions: object[]) => ({ match: "all", conditions });

function world() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const admin = resolvedActor(ctx, insertUser(ctx, { groupId: 4, username: "Boss" }).id);
  const browser = resolvedActor(ctx, insertUser(ctx, { groupId: 3, username: "Mod" }).id);
  return { ctx, node, admin, browser, terminal: asTerminal(browser) };
}

test("a notice and a widget for the Moderator group are not shown to a moderator's device login", async () => {
  const { ctx, admin, browser, terminal } = world();
  await run(ctx, "notices.create", admin, {
    title: "Staff only notice",
    body: "For the team",
    rule: rule({ criterion: "in_group", ids: [3] }),
    dismissible: true,
    active: true,
    startsAt: null,
    endsAt: null,
  });
  ctx.sqlite.exec("DELETE FROM widgets");
  await run(ctx, "widgets.create", admin, {
    position: "overview_top",
    type: "text",
    title: "Staff widget",
    options: { body: "For the team" },
    rule: rule({ criterion: "in_group", ids: [3] }),
  });
  const notices = async (actor: Actor) =>
    (await run(ctx, "notices.current", actor)).items.map((item: { title: string }) => item.title);
  const widgets = async (actor: Actor) =>
    (await run(ctx, "widgets.current", actor, { page: "home" })).items.map(
      (item: { title: string }) => item.title,
    );
  expect(await notices(browser)).toEqual(["Staff only notice"]);
  expect(await notices(terminal)).toEqual([]);
  expect(await widgets(browser)).toEqual(["Staff widget"]);
  expect(await widgets(terminal)).toEqual([]);
});

test("an approval rule that only the Moderator group meets holds a moderator's device login", async () => {
  const { ctx, node, browser, terminal } = world();
  ctx.sqlite
    .prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .run(
      JSON.stringify({
        ...readSiteSettings(ctx),
        approvalRule: rule({ criterion: "in_group", ids: [3] }),
        firstPostsToModerate: 0,
      }),
      ctx.now(),
    );
  const state = async (actor: Actor) =>
    (await run(ctx, "threads.create", actor, { nodeId: node.id, title: "T", body: "Words" })).thread
      .state;
  expect(await state(browser)).toBe("visible");
  expect(await state(terminal)).toBe("moderated");
});
