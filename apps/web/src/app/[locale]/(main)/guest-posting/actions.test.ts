import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;
const asked: { method: string; url: string; body: unknown }[] = [];
let answer: { status: number; body: unknown } = { status: 201, body: {} };

mock.module("server-only", () => ({}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));

const { guestReplyAction, guestThreadAction } = await import("./actions");

const ROOT = "http://127.0.0.1:8787/api/v1";

beforeEach(() => {
  asked.length = 0;
  answer = { status: 201, body: {} };
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({
      method: init.method ?? "GET",
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return Response.json(answer.body, { status: answer.status });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

const refusal = (
  code: string,
  status: number,
  message: string,
  issues?: unknown,
) => ({
  status,
  body: { error: { code, message, issues } },
});

test("a guest's reply goes out with the name and the Turnstile token, and is answered as taken", async () => {
  answer = { status: 201, body: { postId: 40 } };
  const state = await guestReplyAction(
    7,
    {},
    form({ body: "Hello", name: "Wanderer", turnstileToken: "tok" }),
  );
  expect(state).toEqual({ done: true });
  expect(asked).toEqual([
    {
      method: "POST",
      url: `${ROOT}/threads/7/guest-posts`,
      body: { body: "Hello", name: "Wanderer", turnstileToken: "tok" },
    },
  ]);
});

test("a guest's thread goes out to its forum with the title, the prefix, the name and the token", async () => {
  answer = { status: 201, body: { threadId: 9, postId: 41 } };
  const state = await guestThreadAction(
    3,
    {},
    form({
      title: "A question",
      body: "Hello",
      prefixId: "5",
      name: "Wanderer",
      turnstileToken: "tok",
    }),
  );
  expect(state).toEqual({ done: true });
  expect(asked).toEqual([
    {
      method: "POST",
      url: `${ROOT}/nodes/3/guest-threads`,
      body: {
        title: "A question",
        body: "Hello",
        prefixId: 5,
        name: "Wanderer",
        turnstileToken: "tok",
      },
    },
  ]);
});

test("a refusal of the name comes back for the name field, the others for the form", async () => {
  answer = refusal(
    "conflict",
    409,
    "That name belongs to a member. Choose another one, or sign in.",
    [
      {
        path: ["name"],
        message:
          "That name belongs to a member. Choose another one, or sign in.",
      },
    ],
  );
  expect(
    await guestReplyAction(7, {}, form({ body: "Hello", name: "ana" })),
  ).toEqual({
    nameError: "That name belongs to a member. Choose another one, or sign in.",
  });

  answer = refusal("validation", 400, "The security check failed.", [
    { path: ["turnstileToken"], message: "The security check failed." },
  ]);
  expect(
    await guestThreadAction(
      3,
      {},
      form({ title: "T", body: "Hello", name: "Wanderer" }),
    ),
  ).toEqual({ error: "The security check failed." });

  answer = refusal("rate_limited", 429, "Wait a little before posting again.");
  expect(
    await guestReplyAction(7, {}, form({ body: "Hello", name: "Wanderer" })),
  ).toEqual({ error: "Wait a little before posting again." });
});
