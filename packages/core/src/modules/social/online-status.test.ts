import { expect, test } from "bun:test";
import { world } from "../members/fixtures.test";

test("a member shows their online status by default and can hide it again", async () => {
  const w = world();
  const stored = () =>
    w.ctx.sqlite
      .prepare<{ show_online: number }, [number]>("SELECT show_online FROM users WHERE id = ?1")
      .get(w.member.id)!.show_online;
  expect(stored()).toBe(1);
  expect((await w.call("preferences.get", w.memberActor, {})).showOnline).toBe(true);
  const off = await w.call("preferences.update", w.memberActor, { showOnline: false });
  expect(off.showOnline).toBe(false);
  expect(stored()).toBe(0);
  // Another preference leaves it as it is.
  await w.call("preferences.update", w.memberActor, { feedView: "compact" });
  expect((await w.call("preferences.get", w.memberActor, {})).showOnline).toBe(false);
  expect((await w.call("preferences.update", w.memberActor, { showOnline: true })).showOnline).toBe(
    true,
  );
  expect(stored()).toBe(1);
});
