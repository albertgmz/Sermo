import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { form, invalid, redirectedTo } from "../content-kit/harness";
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

const { createPage, savePage, deletePage } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const PAGE = {
  slug: "terms",
  title: "Terms",
  bodyHtml: "",
  bodySource: "",
  isPublished: true,
  version: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("a new page is saved with the slug typed and opens its editor", async () => {
  backend = fakeBackend({ "pages.save": () => Response.json(PAGE) });
  const digest = await redirectedTo(() =>
    createPage(
      null,
      form([
        ["slug", "terms"],
        ["title", "Terms"],
        ["body", "# Terms"],
        ["isPublished", "on"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/pages\/terms\?notice=created;/);
  expect(backend.asked[0]?.body).toEqual({
    title: "Terms",
    body: "# Terms",
    isPublished: true,
    newVersion: false,
  });
});

test("the line breaks a browser posts as CRLF are saved as LF", async () => {
  backend = fakeBackend({ "pages.save": () => Response.json(PAGE) });
  await redirectedTo(() =>
    savePage(
      null,
      form([
        ["slug", "terms"],
        ["title", "Terms"],
        ["body", "# Terms\r\n\r\n- one\r\n- two"],
      ]),
    ),
  );
  expect(backend.asked[0]?.body).toEqual({
    title: "Terms",
    body: "# Terms\n\n- one\n- two",
    isPublished: false,
    newVersion: false,
  });
});

test("a save can publish the page as a new version", async () => {
  backend = fakeBackend({ "pages.save": () => Response.json(PAGE) });
  await redirectedTo(() =>
    savePage(
      null,
      form([
        ["slug", "rules"],
        ["title", "Rules"],
        ["body", "# Rules"],
        ["isPublished", "on"],
        ["newVersion", "on"],
      ]),
    ),
  );
  expect(backend.asked[0]?.body).toEqual({
    title: "Rules",
    body: "# Rules",
    isPublished: true,
    newVersion: true,
  });
});

test("a text over the limit shows the backend's message on the text", async () => {
  backend = fakeBackend({
    "pages.save": () => invalid("body", "Too long, at most 20000."),
  });
  const state = await savePage(
    null,
    form([
      ["slug", "terms"],
      ["title", "Terms"],
      ["body", "x"],
    ]),
  );
  expect(state).toEqual({ fields: { body: "Too long, at most 20000." } });
});

test("a refusal without a field is shown at the top", async () => {
  backend = fakeBackend({
    "pages.save": () => refusal(403, "forbidden", "Not allowed."),
  });
  const state = await createPage(
    null,
    form([
      ["slug", "terms"],
      ["title", "Terms"],
      ["body", "x"],
    ]),
  );
  expect(state).toEqual({ error: "Not allowed." });
});

test("deleting sends the slug and returns to the list", async () => {
  backend = fakeBackend({ "pages.delete": () => Response.json({ ok: true }) });
  const digest = await redirectedTo(() =>
    deletePage(null, form([["id", "terms"]])),
  );
  expect(digest).toMatch(/;\/admin\/pages\?notice=deleted;/);
  expect(backend.asked[0]?.path).toEndWith("/terms");
});

test("deleting with no slug is refused without a call", async () => {
  backend = fakeBackend({});
  expect(await deletePage(null, form([]))).toEqual({
    error: messages.adminContent.errors.id,
  });
  expect(backend.asked).toEqual([]);
});
