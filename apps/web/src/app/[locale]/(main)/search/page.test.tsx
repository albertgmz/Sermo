import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  fakeBackend,
  refusal,
} from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { translator } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { default: SearchPage } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const search = (q: string) =>
  SearchPage({
    searchParams: Promise.resolve({ q }),
  } as unknown as Parameters<typeof SearchPage>[0]);

const tag = (name: string) => () =>
  Response.json({
    name,
    redirect: false,
    seo: {
      title: name,
      description: "",
      canonical: `http://localhost/tags/${name}`,
      robots: "index,follow",
      redirect: false,
      jsonLd: [],
    },
  });

test("a search for one hashtag that is a tag goes to the tag's page, by its current name", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "tags.get": tag("rust"),
  });
  const error = await search("#Rust").catch((thrown) => thrown);
  expect(String(error.digest)).toContain("/tags/rust");
  expect(
    backend.asked.find((call) => call.operation === "tags.get")?.path,
  ).toBe("/api/v1/tags/Rust");
});

test("a hashtag that is no tag is searched for as written", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "tags.get": () => refusal(404, "not_found", "No such tag."),
  });
  expect(await search("#nothing")).toBeDefined();
});

test("any other query is not looked up as a tag", async () => {
  backend = fakeBackend({ "auth.me": () => Response.json(viewerBody(false)) });
  for (const q of ["rust", "#rust tutorial", "", "a #b"])
    expect(await search(q)).toBeDefined();
  expect(backend.asked.some((call) => call.operation === "tags.get")).toBe(
    false,
  );
});
