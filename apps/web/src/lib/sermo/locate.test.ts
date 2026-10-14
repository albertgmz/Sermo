import { expect, test } from "bun:test";
import { type Paged, pageHolding } from "./locate";

// A list of ids 1..n read `size` at a time, newest (highest) first, by cursor.
function list(n: number, size: number) {
  const reads: (string | undefined)[] = [];
  const read = async (cursor: string | undefined): Promise<Paged<number>> => {
    reads.push(cursor);
    const from = cursor === undefined ? n : Number(cursor);
    const items = Array.from({ length: size }, (_, i) => from - i).filter(
      (id) => id >= 1,
    );
    const last = items.at(-1) ?? 1;
    return { items, nextCursor: last > 1 ? String(last - 1) : null };
  };
  return { read, reads };
}

test("an item on the first page is found without reading further", async () => {
  const { read, reads } = list(100, 10);
  const { hit } = await pageHolding(read, (id) => id === 95);
  expect(hit?.cursor).toBeUndefined();
  expect(hit?.page.items).toContain(95);
  expect(reads).toEqual([undefined]);
});

test("an item further down is found with the cursor that opens its page", async () => {
  const { read, reads } = list(100, 10);
  const { hit } = await pageHolding(read, (id) => id === 42);
  expect(hit?.cursor).toBe("50");
  expect(hit?.page.items).toEqual([50, 49, 48, 47, 46, 45, 44, 43, 42, 41]);
  expect(reads).toHaveLength(6);
});

test("an item that is not in the list is a miss, and the first page is handed back", async () => {
  const { read, reads } = list(30, 10);
  const { hit, first } = await pageHolding(read, (id) => id === 500);
  expect(hit).toBeNull();
  expect(first.items[0]).toBe(30);
  expect(reads).toHaveLength(3);
});

test("an item too far down is given up on after ten pages", async () => {
  const { read, reads } = list(10_000, 10);
  const { hit, first } = await pageHolding(read, (id) => id === 1);
  expect(hit).toBeNull();
  expect(first.items[0]).toBe(10_000);
  expect(reads).toHaveLength(10);
});
