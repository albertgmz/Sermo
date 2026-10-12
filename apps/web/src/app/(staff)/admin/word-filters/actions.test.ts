import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { form, invalid, redirectedTo } from "../content-kit/harness";
import { fakeBackend, refusal } from "../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { saveWordFilter, removeWordFilter } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

test("a new filter is upserted with its term, action and an empty replacement as null", async () => {
  backend = fakeBackend({
    "wordFilters.upsert": () => Response.json({ id: 3 }),
  });
  const digest = await redirectedTo(() =>
    saveWordFilter(
      null,
      form([
        ["creating", "1"],
        ["term", "heck"],
        ["action", "moderate"],
        ["replacement", ""],
        ["isActive", "on"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/word-filters\?notice=created;/);
  expect(backend.asked[0]?.body).toEqual({
    term: "heck",
    action: "moderate",
    replacement: null,
    isActive: true,
  });
});

test("an edit of a row sends the same term and says saved", async () => {
  backend = fakeBackend({
    "wordFilters.upsert": () => Response.json({ id: 3 }),
  });
  const digest = await redirectedTo(() =>
    saveWordFilter(
      null,
      form([
        ["term", "heck"],
        ["action", "replace"],
        ["replacement", "heck!"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/word-filters\?notice=saved;/);
  expect(backend.asked[0]?.body).toEqual({
    term: "heck",
    action: "replace",
    replacement: "heck!",
    isActive: false,
  });
});

test("an action the contract does not list is refused without a call", async () => {
  backend = fakeBackend({});
  const state = await saveWordFilter(
    null,
    form([
      ["term", "heck"],
      ["action", "delete"],
    ]),
  );
  expect(backend.asked).toEqual([]);
  expect(state).toEqual({
    fields: { action: messages.adminContent.errors.choice },
  });
});

test("the backend's refusal is shown next to its field", async () => {
  backend = fakeBackend({
    "wordFilters.upsert": () => invalid("term", "Too long."),
  });
  const state = await saveWordFilter(
    null,
    form([
      ["term", "x"],
      ["action", "replace"],
    ]),
  );
  expect(state).toEqual({ fields: { term: "Too long." } });
});

test("removing sends the filter id", async () => {
  backend = fakeBackend({
    "wordFilters.remove": () => Response.json({ ok: true }),
  });
  const digest = await redirectedTo(() =>
    removeWordFilter(null, form([["id", "3"]])),
  );
  expect(digest).toMatch(/;\/admin\/word-filters\?notice=removed;/);
  expect(backend.asked[0]?.path).toEndWith("/3");
});

test("removing with a bad id is refused without a call, and a refusal is shown", async () => {
  backend = fakeBackend({
    "wordFilters.remove": () => refusal(403, "forbidden", "Not allowed."),
  });
  expect(await removeWordFilter(null, form([["id", "x"]]))).toEqual({
    error: messages.adminContent.errors.id,
  });
  expect(backend.asked).toEqual([]);
  expect(await removeWordFilter(null, form([["id", "3"]]))).toEqual({
    error: "Not allowed.",
  });
});
