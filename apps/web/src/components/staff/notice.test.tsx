import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}:${key}`,
}));

const { Notice } = await import("./notice");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const at = (notice: string | string[] | undefined) =>
  Promise.resolve({ notice });

test("a notice the page accepts is shown with its text, from a map or from a namespace", async () => {
  expect(
    renderToStaticMarkup(
      await Notice({ searchParams: at("saved"), notices: { saved: "Saved." } }),
    ),
  ).toContain("Saved.");
  expect(
    renderToStaticMarkup(
      await Notice({
        searchParams: at("created"),
        namespace: "adminGroups.notices",
        shown: ["created", "saved"],
      }),
    ),
  ).toContain("adminGroups.notices:created");
});

test("a name the page does not accept, an array or none shows nothing", async () => {
  for (const searchParams of [at("other"), at(["saved"]), at(undefined)]) {
    expect(
      await Notice({ searchParams, notices: { saved: "Saved." } }),
    ).toBeNull();
    expect(
      await Notice({
        searchParams,
        namespace: "adminUsers.notices",
        shown: ["saved"],
      }),
    ).toBeNull();
  }
  // Not even a name that is a property of every object.
  expect(
    await Notice({
      searchParams: at("toString"),
      notices: { saved: "Saved." },
    }),
  ).toBeNull();
});
