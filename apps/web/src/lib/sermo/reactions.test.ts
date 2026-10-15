import { afterEach, expect, mock, test } from "bun:test";

let cookie = "";
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, toString: () => cookie }),
}));

const { asType, pickerTypes, reactionsView, withoutBlockedPictures } =
  await import("./reactions");

afterEach(() => {
  cookie = "";
});

const WITH_PICTURE = {
  id: 1,
  title: "Spark",
  emoji: "✨",
  score: 1,
  position: 0,
  isActive: true,
  image: { fileId: 9, url: "/api/v1/files/9" },
  frames: { width: 32, height: 32, count: 4, columns: 4 },
  forumIds: [] as number[],
  hideWhenLocked: false,
  rule: null,
  access: "open" as "open" | "locked" | "hidden",
  lockHint: null as string | null,
};
const PLAIN = {
  ...WITH_PICTURE,
  id: 2,
  title: "Like",
  emoji: "👍",
  image: null,
  frames: null,
};

test("a raw backend type cannot reach asType, the picker or the summary", () => {
  // @ts-expect-error a type that did not go through withoutBlockedPictures is refused
  void asType(WITH_PICTURE);
  // @ts-expect-error nor can a list of them
  void pickerTypes([WITH_PICTURE], null);
  // @ts-expect-error nor the summary
  void reactionsView({ counts: {}, total: 0, mine: null }, [PLAIN]);
});

test("a type with a picture hands its address and cut to the components", async () => {
  const [spark, like] = await withoutBlockedPictures([WITH_PICTURE, PLAIN]);
  expect(asType(spark)).toEqual({
    id: 1,
    key: "1",
    label: "Spark",
    emoji: "✨",
    picture: { url: "/api/v1/files/9", frames: WITH_PICTURE.frames },
  });
  expect(asType(like).picture).toBeNull();
});

test("with LITE off the pictures pass through", async () => {
  const types = await withoutBlockedPictures([WITH_PICTURE, PLAIN]);
  expect(types).toEqual([WITH_PICTURE, PLAIN]);
  expect(pickerTypes(types, null)[0].picture?.url).toBe("/api/v1/files/9");
});

test("with the master switch or the reactions category on, the address is dropped on the server", async () => {
  for (const value of ["all", "reactions", "all.reactions"]) {
    cookie = `forum_lite=${value}`;
    const types = await withoutBlockedPictures([WITH_PICTURE, PLAIN]);
    expect(types[0].image).toBeNull();
    expect(types[0].frames).toBeNull();
    expect(JSON.stringify(types)).not.toContain("/api/v1/files/9");
    // The emoji is what is left to draw.
    expect(pickerTypes(types, null)[0]).toEqual({
      id: 1,
      key: "1",
      label: "Spark",
      emoji: "✨",
      picture: null,
    });
    const view = reactionsView(
      { counts: { "1": 2 }, total: 2, mine: null },
      types,
    );
    expect(view.byType[0].type.picture).toBeNull();
  }
});

test("another category does not hide reaction pictures", async () => {
  cookie = "forum_lite=awards.shop";
  const types = await withoutBlockedPictures([WITH_PICTURE]);
  expect(types[0].image).not.toBeNull();
});

// The picker mirrors what the backend decides; these are the states it draws.
const sealed = (...types: (typeof PLAIN)[]) => withoutBlockedPictures(types);
const typeOf = (id: number, fields: Partial<typeof PLAIN> = {}) => ({
  ...PLAIN,
  id,
  title: `Type ${id}`,
  ...fields,
});

test("a type the viewer's standing rules out is offered locked, with the hint", async () => {
  const types = await sealed(
    typeOf(1),
    typeOf(2, {
      access: "locked",
      lockHint: "Unlocks with: Post count: 500 or more",
    }),
  );
  const [open, locked] = pickerTypes(types, null);
  expect(open.locked).toBeUndefined();
  expect(locked.locked).toBe("Unlocks with: Post count: 500 or more");
  expect(locked.id).toBe(2);
});

test("a type set to hide is left out of the picker but still names its reactions", async () => {
  const types = await sealed(typeOf(1), typeOf(2, { access: "hidden" }));
  expect(pickerTypes(types, null).map((type) => type.id)).toEqual([1]);
  const view = reactionsView({ counts: { "2": 3 }, total: 3, mine: 2 }, types);
  expect(view.byType.map(({ type }) => type.id)).toEqual([2]);
});

test("an inactive type is not offered, locked or not", async () => {
  const types = await sealed(
    typeOf(1, { isActive: false }),
    typeOf(2, { isActive: false, access: "locked", lockHint: "Locked" }),
  );
  expect(pickerTypes(types, null)).toEqual([]);
});

test("a type limited to forums is offered in them and nowhere else", async () => {
  const types = await sealed(typeOf(1, { forumIds: [7, 9] }), typeOf(2));
  expect(pickerTypes(types, 7).map((type) => type.id)).toEqual([1, 2]);
  expect(pickerTypes(types, 8).map((type) => type.id)).toEqual([2]);
  // Wall posts, comments and conversations are in no forum.
  expect(pickerTypes(types, null).map((type) => type.id)).toEqual([2]);
});

test("a locked type with no hint is still locked", async () => {
  const types = await sealed(typeOf(1, { access: "locked" }));
  expect(pickerTypes(types, null)[0].locked).toBe("");
});
