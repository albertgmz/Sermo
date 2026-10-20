import { afterAll, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const nextHeaders = { ...(await import("next/headers")) };
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { ItemPreview } = await import("./item-preview");

afterAll(() => {
  mock.module("next/headers", () => nextHeaders);
});

const STAMP = "2026-01-01T00:00:00.000Z";
const image = (url: string) => ({
  id: 1,
  url,
  smallUrl: url,
  width: 512,
  height: 512,
  mimeType: "image/png",
});
// The picture an item holds: the file and where it is served from.
const itemImage = (url: string) => ({ fileId: 1, url });
const wearer = {
  username: "ember",
  avatar: null,
  frame: null,
  nameColor: null,
};
const catalogs = {
  frames: new Map([
    [
      7,
      {
        id: 7,
        name: "Copper",
        image: image("/api/v1/files/frame.png"),
        placement: { width: 160, left: -30, top: -30, scale: 100 },
        createdAt: STAMP,
      },
    ],
  ]),
  covers: new Map(),
  colors: new Map(),
} as unknown as Parameters<typeof ItemPreview>[0]["catalogs"];

async function draw(
  item: Parameters<typeof ItemPreview>[0]["item"],
  size?: "card" | "thumb",
) {
  const element = ItemPreview({ item, catalogs, wearer, size });
  return new Response(await renderToReadableStream(withIntl(element))).text();
}

const frameItem = (picture: boolean) => ({
  effect: { type: "frame" as const, frameId: 7 },
  image: picture ? itemImage("/api/v1/files/item.png") : null,
});

const count = (html: string, needle: string) => html.split(needle).length - 1;

test("a frame is drawn once, on the avatar, whether or not the item has a picture", async () => {
  for (const picture of [false, true]) {
    const html = await draw(frameItem(picture));
    expect(count(html, "frame.png"), String(picture)).toBe(1);
    expect(html, String(picture)).not.toContain("item.png");
  }
});

test("the avatar wearing the frame is sized from the frame's width so the whole frame fits the box", async () => {
  const html = await draw(frameItem(false));
  // 80 percent of the box, divided by the frame's 160 percent of the avatar.
  expect(html).toContain("min(50cqh, 50cqw)");
  expect(html).toContain("[container-type:size]");
  const thumb = await draw(frameItem(false), "thumb");
  expect(thumb).toContain("min(50cqh, 50cqw)");
});

test("a frame the catalog no longer holds keeps the item's picture", async () => {
  const html = await draw({
    effect: { type: "frame", frameId: 99 },
    image: itemImage("/api/v1/files/item.png"),
  });
  expect(html).toContain("item.png");
});
