import { expect, test } from "bun:test";
import { createTestContext, insertUser } from "../../testing";
import { getAuth, resolveActor } from ".";

test("resolving a signed-in actor buffers activity without writing", async () => {
  const ctx = createTestContext();
  const user = insertUser(ctx);
  const created = await getAuth(ctx).api.createApiKey({
    body: { userId: String(user.id), name: "activity" },
  });
  const changes = () => ctx.sqlite.query<{ n: number }, []>("SELECT total_changes() AS n").get()!.n;
  const before = changes();
  const { actor } = await resolveActor(
    ctx,
    new Headers({ authorization: `Bearer ${created.key}` }),
  );
  expect(actor.kind).toBe("token");
  expect(changes()).toBe(before);
  expect(ctx.activity.get(user.id)).toBe(ctx.now());
  await resolveActor(ctx, new Headers());
  expect(ctx.activity.size).toBe(1);
});
