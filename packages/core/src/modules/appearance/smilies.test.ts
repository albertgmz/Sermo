import { expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { execute } from "../../operation";
import { getOperation } from "../../operations";

type Listed = { items: { id: number; title: string; codes: string[]; emoji: string }[] };

const list = (ctx: ReturnType<typeof createTestContext>, actor: Parameters<typeof execute>[2]) =>
  execute(ctx, getOperation("smilies.list"), actor, {}) as Promise<Listed>;

test("a guest reads fcuba's smilies in their order, each with its codes and emoji", async () => {
  const ctx = createTestContext();
  const { items } = await list(ctx, GUEST);
  expect(items).toHaveLength(26);
  expect(items[0]).toEqual({ id: 4, title: "Mad", codes: [":mad:", ">:(", ":@"], emoji: "😡" });
  expect(items.find((item) => item.title === "Laugh")).toEqual({
    id: 17,
    title: "Laugh",
    codes: [":LOL:"],
    emoji: "😆",
  });
  expect(items.find((item) => item.id === 22)?.codes).toEqual(["(y)", ":like:"]);
  expect(items.at(-1)?.title).toBe("Ninja");
});

test("a member reads the same list, in the order of its position", async () => {
  const ctx = createTestContext();
  ctx.sqlite.run("UPDATE smilies SET position = 0 WHERE id = 32");
  const member = userActor(insertUser(ctx, { username: "ana" }));
  const { items } = await list(ctx, member);
  expect(items.map((item) => item.id).slice(0, 2)).toEqual([32, 4]);
});
