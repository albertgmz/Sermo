import { expect, test } from "bun:test";
import {
  formatRef,
  mergeEntries,
  neighbours,
  parseRef,
  withPicture,
} from "./picture-ref";
import type { GatedUrl, PictureEntry } from "./picture-types";

const entry = (id: number): PictureEntry => ({
  id,
  ref: { kind: "post", contentId: id * 10, fileId: id * 100 },
  url: `/api/v1/files/${id}` as GatedUrl,
  width: 10,
  height: 10,
  widths: [],
  label: `Picture ${id}`,
});

test("a reference is written and read back, and nothing else is a reference", () => {
  const post = { kind: "post", contentId: 99, fileId: 7 } as const;
  expect(formatRef(post)).toBe("post-99-7");
  expect(parseRef("post-99-7")).toEqual(post);
  expect(parseRef("wall-4-6")).toEqual({
    kind: "wall",
    contentId: 4,
    fileId: 6,
  });
  for (const bad of [
    null,
    undefined,
    "",
    "post-0-7",
    "post-099-7",
    "post-9-0x7",
    "post-1e2-7",
    "post-9",
    "thread-9-7",
    "post-9-7-1",
    "post-99999999999999999-7",
    " post-9-7",
  ])
    expect(parseRef(bad), String(bad)).toBeNull();
});

test("the picture is set in an address and taken out again, the rest left as it is", () => {
  const ref = { kind: "post", contentId: 99, fileId: 7 } as const;
  expect(withPicture("/?tab=media&pages=3", ref)).toBe(
    "/?tab=media&pages=3&picture=post-99-7",
  );
  expect(withPicture("/?tab=media&picture=wall-1-2&pages=3", ref)).toBe(
    "/?tab=media&picture=post-99-7&pages=3",
  );
  expect(withPicture("/?tab=media&picture=post-99-7&pages=3", null)).toBe(
    "/?tab=media&pages=3",
  );
  expect(withPicture("/?picture=post-99-7", null)).toBe("/");
});

test("pictures are kept newest first and a page seen twice adds nothing", () => {
  const held = mergeEntries([], [entry(30), entry(20)]);
  expect(held.map((e) => e.id)).toEqual([30, 20]);
  expect(mergeEntries(held, [entry(20), entry(30)])).toBe(held);
  expect(mergeEntries(held, [entry(10), entry(25)]).map((e) => e.id)).toEqual([
    30, 25, 20, 10,
  ]);
});

test("the neighbours of a picture are the ones either side, none past the ends", () => {
  const list = [entry(30), entry(20), entry(10)];
  const at = (id: number) => neighbours(list, entry(id).ref);
  expect(at(20)).toMatchObject({ index: 1 });
  expect(at(20).previous?.id).toBe(30);
  expect(at(20).next?.id).toBe(10);
  expect(at(30).previous).toBeNull();
  expect(at(10).next).toBeNull();
  // A picture the list does not hold (a link to one) has no neighbours.
  expect(at(5)).toEqual({ index: -1, previous: null, next: null });
});
