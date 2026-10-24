import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { ApiNode } from "./forums";

let cookie = "";
mock.module("server-only", () => ({}));
const headersModule = { ...(await import("next/headers")) };
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => cookie }),
}));
const { forumChoices } = await import("./forum-choices");

afterAll(() => {
  mock.module("next/headers", () => headersModule);
});
beforeEach(() => {
  cookie = "";
});

const picture = (fileId: number) => ({
  fileId,
  url: `/api/v1/files/${fileId}`,
});
const node = (id: number, over: Record<string, unknown> = {}) =>
  ({
    id,
    parentId: null,
    type: "forum",
    title: `Forum ${id}`,
    icon: null,
    cover: null,
    permissions: { canPost: true, canModerate: false },
    settings: { isReadOnly: false },
    ...over,
  }) as unknown as ApiNode;

test("a forum's picture is its cover, else its icon, else none", async () => {
  const choices = await forumChoices([
    node(1, { cover: picture(10), icon: picture(11) }),
    node(2, { icon: picture(21) }),
    node(3),
  ]);
  expect(choices.map((choice) => choice.image)).toEqual([
    "/api/v1/files/10",
    "/api/v1/files/21",
    null,
  ]);
});

test("a read-only forum is marked so, whatever the viewer may do there", async () => {
  const [choice] = await forumChoices([
    node(1, {
      permissions: { canPost: true, canModerate: true },
      settings: { isReadOnly: true },
    }),
  ]);
  expect(choice).toMatchObject({ canPost: true, readOnly: true });
});

test("with forum art blocked no address reaches the chooser", async () => {
  cookie = "forum_lite=forumArt";
  const choices = await forumChoices([
    node(1, { cover: picture(10), icon: picture(11) }),
    node(2, { icon: picture(21) }),
  ]);
  expect(choices.map((choice) => choice.image)).toEqual([null, null]);
});
