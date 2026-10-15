import { afterEach, expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=abc" }),
  cookies: async () => ({
    set: () => {},
    delete: () => {},
    toString: () => "",
  }),
}));

const source = "./actions.ts?styleguide";
const actions = (await import(source)) as typeof import("./actions");

// Answers auth.me as the given kind of visitor.
function visitor(kind: "guest" | "member" | "staff") {
  const body = viewerBody(kind !== "guest");
  if (kind === "staff") body.staff.panel = true;
  globalThis.fetch = (async () =>
    Response.json(body)) as unknown as typeof fetch;
}

const form = (fields: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const STATE = {};

test("every demo action refuses a caller who may not open the styleguide", async () => {
  for (const kind of ["guest", "member"] as const) {
    visitor(kind);
    await expect(actions.discard(form())).rejects.toThrow();
    await expect(actions.discardForm()).rejects.toThrow();
    await expect(actions.discardQuote()).rejects.toThrow();
    await expect(
      actions.echoBbCode(null, form({ body: "x" })),
    ).rejects.toThrow();
    await expect(
      actions.saveSample(STATE, form({ title: "x" })),
    ).rejects.toThrow();
    await expect(
      actions.confirmSample(STATE, form({ actorPassword: "x" })),
    ).rejects.toThrow();
  }
});

test("a caller who may open the styleguide gets the demo answers, at once", async () => {
  visitor("staff");
  const start = performance.now();
  expect(await actions.saveSample(STATE, form())).toMatchObject({
    fields: { title: "Enter a title." },
  });
  const saved = await actions.saveSample(STATE, form({ title: "t" }));
  expect(typeof saved?.notice).toBe("string");
  const refused = await actions.confirmSample(
    STATE,
    form({ actorPassword: "wrong" }),
  );
  expect(typeof refused?.fields?.actorPassword).toBe("string");
  expect(performance.now() - start).toBeLessThan(500);
});
