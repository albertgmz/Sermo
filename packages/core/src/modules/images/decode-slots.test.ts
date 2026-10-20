import { expect, test } from "bun:test";
import { decodeSlots } from "./decode-slots";

test("a third decode waits until one of two running ends, and the slots are not lost on failure", async () => {
  const withSlot = decodeSlots(2);
  const started: number[] = [];
  const finish: (() => void)[] = [];
  const decode = (id: number, fail = false) =>
    withSlot(
      () =>
        new Promise<number>((resolve, reject) => {
          started.push(id);
          finish[id] = () => (fail ? reject(new Error("broken")) : resolve(id));
        }),
    );
  const first = decode(0, true);
  const second = decode(1);
  const third = decode(2);
  const fourth = decode(3);
  await Bun.sleep(5);
  expect(started).toEqual([0, 1]);
  finish[0]!();
  await expect(first).rejects.toThrow("broken");
  await Bun.sleep(5);
  expect(started).toEqual([0, 1, 2]);
  finish[1]!();
  expect(await second).toBe(1);
  await Bun.sleep(5);
  expect(started).toEqual([0, 1, 2, 3]);
  finish[2]!();
  finish[3]!();
  expect(await Promise.all([third, fourth])).toEqual([2, 3]);
  // Both slots are free again.
  const later = [decode(4), decode(5)];
  await Bun.sleep(5);
  expect(started).toEqual([0, 1, 2, 3, 4, 5]);
  finish[4]!();
  finish[5]!();
  await Promise.all(later);
});
