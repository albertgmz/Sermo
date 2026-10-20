import { expect, test } from "bun:test";
import * as z from "zod";
import { GUEST, requireAuthenticated } from "./actor";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "./errors";
import { defineContract, execute, implement } from "./operation";
import { createTestContext } from "./testing";

const contract = defineContract({
  name: "test.thing",
  summary: "A test operation.",
  kind: "write",
  input: z.object({ id: z.number().int().min(1) }),
  output: z.object({ ok: z.literal(true) }),
});

const run = (op: ReturnType<typeof implement>, input: unknown, actor = GUEST) => {
  const ctx = createTestContext();
  return { ctx, result: execute(ctx, op, actor, input) };
};

test("input that does not validate is refused as the operation refuses the caller", async () => {
  const guestRefused = implement(contract, (_ctx, actor) => {
    requireAuthenticated(actor);
    return { ok: true as const };
  });
  await expect(run(guestRefused, {}).result).rejects.toBeInstanceOf(UnauthenticatedError);

  const forbidden = implement(contract, () => {
    throw new ForbiddenError();
  });
  await expect(run(forbidden, { id: "x" }).result).rejects.toBeInstanceOf(ForbiddenError);
});

test("an operation that reads its input before deciding still validates first", async () => {
  for (const op of [
    implement(contract, (_ctx, actor, input) => {
      if (input.id === 1) throw new ForbiddenError();
      requireAuthenticated(actor);
      return { ok: true as const };
    }),
    implement(contract, (_ctx, actor, { id }) => {
      requireAuthenticated(actor);
      return { ok: (id > 0) as true };
    }),
    // Not a refusal of the caller: reported as the invalid input it is.
    implement(contract, () => {
      throw new Error("boom");
    }),
    implement(contract, () => ({ ok: true as const })),
  ])
    await expect(run(op, {}).result).rejects.toBeInstanceOf(ValidationError);
});

test("an async operation is decided by what it checks before it awaits", async () => {
  const op = implement(contract, async (_ctx, actor, input) => {
    requireAuthenticated(actor);
    await Promise.resolve();
    return { ok: input.id > 0 ? (true as const) : (true as const) };
  });
  await expect(run(op, {}).result).rejects.toBeInstanceOf(UnauthenticatedError);
});

test("the run against unreadable input changes nothing and leaves the connection writable", async () => {
  const ctx = createTestContext();
  ctx.sqlite.run("CREATE TABLE probe (n INTEGER)");
  const writes = implement(contract, (c, _actor, input) => {
    c.sqlite.run("INSERT INTO probe VALUES (1)");
    return { ok: input.id > 0 ? (true as const) : (true as const) };
  });
  await expect(execute(ctx, writes, GUEST, {})).rejects.toBeInstanceOf(ValidationError);
  expect(ctx.sqlite.query("SELECT COUNT(*) AS n FROM probe").get()).toEqual({ n: 0 });
  ctx.sqlite.run("INSERT INTO probe VALUES (2)");
  expect(ctx.sqlite.query("SELECT COUNT(*) AS n FROM probe").get()).toEqual({ n: 1 });
});

test("valid input runs the operation once with its input", async () => {
  let calls = 0;
  const op = implement(contract, (_ctx, _actor, input) => {
    calls += 1;
    expect(input).toEqual({ id: 3 });
    return { ok: true as const };
  });
  expect(await run(op, { id: 3 }).result).toEqual({ ok: true });
  expect(calls).toBe(1);
});
