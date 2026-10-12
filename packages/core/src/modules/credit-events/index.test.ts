import { afterEach, describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { writeTx } from "../../db/tx";
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { dispatchEvents, publishEvent } from "../../events";
import { type AnyOperation, execute } from "../../operation";
import { createTestContext, insertNode, insertUser, tokenActor, userActor } from "../../testing";
import { operations, registerCreditRuleJobs } from ".";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) ctx.sqlite.close(true);
});
function fixture() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const member = insertUser(ctx);
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const forum = insertNode(ctx, {});
  const call = (name: string, input: unknown = {}, actor = admin) =>
    execute(
      ctx,
      operations.find((op) => op.name === `creditRules.${name}`)! as AnyOperation,
      actor,
      input,
    );
  return { ctx, admin, member, moderator, forum, call };
}
const rule = { title: "Registration", trigger: "registered", amount: 10 };

describe("credit rule administration", () => {
  for (const name of ["list", "create", "update", "delete"]) {
    test(`${name} requires admin.creditRules, including for another admin's rule`, async () => {
      const f = fixture();
      const created = await f.call("create", rule);
      const input = name === "create" ? rule : { ruleId: created.id, amount: 11 };
      await expect(f.call(name, input, GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(f.call(name, input, userActor(f.member))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(f.call(name, input, f.moderator)).rejects.toBeInstanceOf(ForbiddenError);
      const other = tokenActor(insertUser(f.ctx, { groupId: 4 }));
      await expect(f.call(name, input, other)).resolves.toBeDefined();
    });
  }

  test("creates, lists, updates and deletes, preserving defaults and nullable limits", async () => {
    const f = fixture();
    expect(await f.call("list")).toEqual({ items: [] });
    const created = await f.call("create", rule);
    expect(created).toMatchObject({ ...rule, isActive: true, limit: null, nodeIds: [] });
    const updated = await f.call("update", {
      ruleId: created.id,
      title: "Changed",
      amount: -4,
      isActive: false,
      limit: { count: 2, windowHours: 24 },
    });
    expect(updated).toMatchObject({
      title: "Changed",
      amount: -4,
      isActive: false,
      trigger: "registered",
    });
    expect(await f.call("list")).toEqual({ items: [updated] });
    expect(await f.call("update", { ruleId: created.id, limit: null })).toMatchObject({
      limit: null,
    });
    expect(await f.call("delete", { ruleId: created.id })).toEqual({ ok: true });
    expect(await f.call("list")).toEqual({ items: [] });
    for (const name of ["update", "delete"])
      await expect(f.call(name, { ruleId: created.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  test("validates forum restrictions and complete limits on create and update", async () => {
    const f = fixture();
    const category = insertNode(f.ctx, { type: "category" });
    await expect(f.call("create", { ...rule, nodeIds: [f.forum.id] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    for (const nodeId of [category.id, 999999])
      await expect(
        f.call("create", { ...rule, trigger: "thread_created", nodeIds: [nodeId] }),
      ).rejects.toBeInstanceOf(ValidationError);
    for (const limit of [{ count: 2 }, { windowHours: 1 }])
      await expect(f.call("create", { ...rule, limit })).rejects.toBeInstanceOf(ValidationError);
    const created = await f.call("create", {
      ...rule,
      trigger: "reply_posted",
      nodeIds: [f.forum.id],
    });
    await expect(
      f.call("update", { ruleId: created.id, nodeIds: [category.id] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      f.call("update", { ruleId: created.id, limit: { count: 1 } }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await f.call("update", { ruleId: created.id, nodeIds: [] })).toMatchObject({
      nodeIds: [],
    });
  });

  test("the permission can be delegated to a member and denied to an administrator", async () => {
    const f = fixture();
    f.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, user_id, value) SELECT id, ?1, 1 FROM permission_definitions WHERE key = 'admin.creditRules'",
      )
      .run(f.member.id);
    const member = tokenActor(f.member);
    const created = await f.call("create", rule, member);
    expect(await f.call("list", {}, member)).toEqual({ items: [created] });
    await expect(
      f.call("update", { ruleId: created.id, amount: 20 }, member),
    ).resolves.toMatchObject({ amount: 20 });
    await expect(f.call("delete", { ruleId: created.id }, member)).resolves.toEqual({ ok: true });
    if (f.admin.kind === "guest") throw new Error("Expected a member.");
    f.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, user_id, value) SELECT id, ?1, -1 FROM permission_definitions WHERE key = 'admin.creditRules'",
      )
      .run(f.admin.userId);
    for (const name of ["list", "create", "update", "delete"])
      await expect(
        f.call(name, name === "create" ? rule : { ruleId: created.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

test("registration pays once through the durable subscriber, including cursor replay", async () => {
  const f = fixture();
  await f.call("create", rule);
  registerCreditRuleJobs(f.ctx);
  writeTx(f.ctx, () =>
    publishEvent(f.ctx, { type: "member.registered", targetType: "user", targetId: f.member.id }),
  );
  await dispatchEvents(f.ctx);
  const balance = () =>
    f.ctx.sqlite.prepare("SELECT credits FROM users WHERE id = ?1").get(f.member.id);
  expect(balance()).toEqual({ credits: 10 });
  f.ctx.sqlite
    .prepare("UPDATE event_subscribers SET last_event_id = 0 WHERE name = 'credit-rules'")
    .run();
  await dispatchEvents(f.ctx);
  expect(balance()).toEqual({ credits: 10 });
  expect(f.ctx.sqlite.prepare("SELECT amount, type FROM credit_transactions").all()).toEqual([
    { amount: 10, type: "event" },
  ]);
});
