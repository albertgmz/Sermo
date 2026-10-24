import { expect, test } from "bun:test";
import { createTestContext } from "@sermo/core/testing";
import type { Ctx } from "../../context";
import { getAuth } from "./index";

const registered = (ctx: Ctx) =>
  ctx.sqlite
    .prepare<{ target_type: string; target_id: number; payload: string }, []>(
      "SELECT target_type, target_id, payload FROM domain_events WHERE type = 'member.registered' ORDER BY id",
    )
    .all();

const identity = (n: number) => ({
  name: `Person ${n}`,
  email: `person${n}@example.test`,
  password: "password123",
  username: `person_${n}`,
});

test("signing up publishes exactly one member.registered event for the new member", async () => {
  const ctx = createTestContext();
  expect(registered(ctx)).toEqual([]);
  const response = await getAuth(ctx).api.signUpEmail({ body: identity(1), asResponse: true });
  expect(response.status).toBe(200);
  const { user } = (await response.json()) as { user: { id: string } };
  const rows = registered(ctx);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ target_type: "user", target_id: Number(user.id) });
  expect(JSON.parse(rows[0]!.payload)).toEqual({});
  expect(
    ctx.sqlite
      .prepare<{ id: number }, [number]>("SELECT id FROM users WHERE id = ?1")
      .get(Number(user.id)),
  ).toEqual({ id: Number(user.id) });
});

test("each sign-up publishes its own event, in order", async () => {
  const ctx = createTestContext();
  const auth = getAuth(ctx);
  const ids: number[] = [];
  for (const n of [1, 2, 3]) {
    const { user } = await auth.api.signUpEmail({ body: identity(n) });
    ids.push(Number(user.id));
  }
  expect(registered(ctx).map((row) => row.target_id)).toEqual(ids);
});

test("a rejected sign-up publishes nothing and leaves no member row", async () => {
  const ctx = createTestContext();
  const auth = getAuth(ctx);
  await auth.api.signUpEmail({ body: identity(1) });
  const before = registered(ctx).length;
  // Same username, different email: refused when the member row is inserted.
  await expect(
    auth.api.signUpEmail({ body: { ...identity(2), username: identity(1).username } }),
  ).rejects.toThrow();
  expect(registered(ctx)).toHaveLength(before);
  expect(
    ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM users WHERE id > 0").get()!.n,
  ).toBe(1);
});
