import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  refreshed = 0;
});

let refreshed = 0;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3105" }),
  cookies: async () => ({
    set: () => {},
    delete: () => {},
    toString: () => "",
  }),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  revalidatePath: () => {},
  refresh: () => {
    refreshed += 1;
  },
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));

const source = "./actions.ts?acceptance";
const { acceptTerms, react } = (await import(
  source
)) as typeof import("./actions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const refusal = (status: number, code: string, issues?: unknown) =>
  Response.json(
    {
      error: {
        code,
        message: "backend wording",
        ...(issues ? { issues } : {}),
      },
    },
    { status },
  );

function backend(response: Response) {
  const asked: { path: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit) => {
    asked.push({
      path: new URL(input).pathname,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return response.clone();
  }) as unknown as typeof fetch;
  return asked;
}

const accepted = (...values: string[]) => {
  const data = new FormData();
  for (const value of values) data.append("accept", value);
  return data;
};

test("the prompt's button accepts the versions it showed and draws the page again", async () => {
  const asked = backend(Response.json({ ok: true }));
  expect(await acceptTerms({}, accepted("terms:3", "rules:2"))).toEqual({});
  expect(asked).toHaveLength(1);
  expect(asked[0]?.path).toBe("/api/v1/terms/accept");
  expect(asked[0]?.body).toEqual({
    accept: [
      { kind: "terms", version: 3 },
      { kind: "rules", version: 2 },
    ],
  });
  expect(refreshed).toBe(1);
});

test("a version that moved on is refused with the backend's words and the page is drawn again", async () => {
  backend(refusal(409, "conflict"));
  expect(await acceptTerms({}, accepted("terms:1"))).toEqual({
    error: "backend wording",
  });
  expect(refreshed).toBe(1);
});

test("a forged answer is not sent to the backend", async () => {
  const asked = backend(Response.json({ ok: true }));
  for (const forged of [
    [],
    ["terms"],
    ["terms:x"],
    ["privacy:1"],
    ["terms:0"],
    ["terms:1", "nonsense"],
  ]) {
    const state = await acceptTerms({}, accepted(...forged));
    expect(state.error, forged.join()).toBeDefined();
  }
  expect(asked).toEqual([]);
});

test("a reaction refused for a missing acceptance says so and brings the prompt up", async () => {
  backend(
    refusal(403, "forbidden", [{ path: ["acceptance"], message: "terms" }]),
  );
  const state = await react("post", 9, 2);
  expect(state.error).toBe(translator("lib.errors")("acceptanceRequired"));
  expect(state.error).not.toBe("backend wording");
  expect(refreshed).toBe(1);
});

test("any other refusal of a reaction draws nothing again", async () => {
  backend(refusal(403, "forbidden"));
  const state = await react("post", 9, 2);
  expect(state.error).toBe("backend wording");
  expect(refreshed).toBe(0);
});

test("a reaction refused for an account waiting for approval says so in the web app's words and brings the notice up", async () => {
  backend(
    refusal(403, "forbidden", [{ path: ["approval"], message: "awaiting" }]),
  );
  const state = await react("post", 9, 2);
  expect(state.error).toBe(translator("lib.errors")("approvalPending"));
  expect(state.error).not.toBe("backend wording");
  expect(refreshed).toBe(1);
});
