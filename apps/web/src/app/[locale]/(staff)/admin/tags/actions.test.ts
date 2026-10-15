import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { form, redirectedTo } from "../content-kit/harness";
import { fakeBackend, refusal } from "../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { renameTag, mergeTag, deleteTag } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const tag = (id: number, name: string) => ({
  id,
  name,
  threadCount: 1,
  aliases: [],
  createdAt: "2026-01-01T00:00:00.000Z",
});

test("renaming sends the tag id and the new name", async () => {
  backend = fakeBackend({
    "tags.rename": () => Response.json(tag(3, "color")),
  });
  const digest = await redirectedTo(() =>
    renameTag(
      null,
      form([
        ["id", "3"],
        ["name", "Color"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/tags\?notice=renamed;/);
  expect(backend.asked[0]?.path).toEndWith("/admin/tags/3");
  expect(backend.asked[0]?.body).toEqual({ name: "Color" });
});

test("a refused rename shows the backend's message by the field", async () => {
  backend = fakeBackend({
    "tags.rename": () =>
      refusal(409, "conflict", "Another tag already has that name."),
  });
  const state = await renameTag(
    null,
    form([
      ["id", "3"],
      ["name", "taken"],
    ]),
  );
  expect(state).toEqual({ error: "Another tag already has that name." });
});

test("a bad id is refused without a call", async () => {
  backend = fakeBackend({});
  for (const action of [renameTag, mergeTag, deleteTag])
    expect(await action(null, form([["id", "x"]]))).toEqual({
      error: messages.adminContent.errors.id,
    });
  expect(backend.asked).toEqual([]);
});

test("merging looks the other tag up by name, then merges by id", async () => {
  backend = fakeBackend({
    "tags.list": () =>
      Response.json({ items: [tag(9, "color")], nextCursor: null }),
    "tags.merge": () => Response.json(tag(9, "color")),
  });
  const digest = await redirectedTo(() =>
    mergeTag(
      null,
      form([
        ["id", "3"],
        ["into", "#Color"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/tags\?notice=merged;/);
  expect(backend.asked.map((call) => call.operation)).toEqual([
    "tags.list",
    "tags.merge",
  ]);
  expect(backend.asked[1]?.body).toEqual({ intoTagId: 9 });
});

test("merging into a name no tag has says so and merges nothing", async () => {
  backend = fakeBackend({
    // The first tag that starts with the name is another one.
    "tags.list": () =>
      Response.json({ items: [tag(9, "colours")], nextCursor: null }),
  });
  const state = await mergeTag(
    null,
    form([
      ["id", "3"],
      ["into", "color"],
    ]),
  );
  expect(state).toEqual({ fields: { into: messages.adminContent.errors.tag } });
  expect(backend.asked.map((call) => call.operation)).toEqual(["tags.list"]);
});

test("deleting sends the tag id and a refusal is shown", async () => {
  backend = fakeBackend({ "tags.delete": () => Response.json({ ok: true }) });
  const digest = await redirectedTo(() => deleteTag(null, form([["id", "3"]])));
  expect(digest).toMatch(/;\/admin\/tags\?notice=deleted;/);
  expect(backend.asked[0]?.path).toEndWith("/admin/tags/3");
  backend.restore();
  backend = fakeBackend({
    "tags.delete": () => refusal(403, "forbidden", "Not allowed."),
  });
  expect(await deleteTag(null, form([["id", "3"]]))).toEqual({
    error: "Not allowed.",
  });
});
