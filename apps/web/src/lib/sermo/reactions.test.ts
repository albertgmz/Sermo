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
};
const PLAIN = {
  ...WITH_PICTURE,
  id: 2,
  title: "Like",
  emoji: "👍",
  image: null,
  frames: null,
};

test("a type with a picture hands its address and cut to the components", () => {
  expect(asType(WITH_PICTURE)).toEqual({
    id: 1,
    key: "1",
    label: "Spark",
    emoji: "✨",
    picture: { url: "/api/v1/files/9", frames: WITH_PICTURE.frames },
  });
  expect(asType(PLAIN).picture).toBeNull();
});

test("with LITE off the pictures pass through", async () => {
  const types = await withoutBlockedPictures([WITH_PICTURE, PLAIN]);
  expect(types).toEqual([WITH_PICTURE, PLAIN]);
  expect(pickerTypes(types)[0].picture?.url).toBe("/api/v1/files/9");
});

test("with the master switch or the reactions category on, the address is dropped on the server", async () => {
  for (const value of ["all", "reactions", "all.reactions"]) {
    cookie = `forum_lite=${value}`;
    const types = await withoutBlockedPictures([WITH_PICTURE, PLAIN]);
    expect(types[0].image).toBeNull();
    expect(types[0].frames).toBeNull();
    expect(JSON.stringify(types)).not.toContain("/api/v1/files/9");
    // The emoji is what is left to draw.
    expect(pickerTypes(types)[0]).toEqual({
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
