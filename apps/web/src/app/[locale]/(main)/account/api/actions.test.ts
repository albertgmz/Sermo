import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));

let refreshed = 0;
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  refresh: () => {
    refreshed++;
  },
}));

const { issueKey, revokeKey } = await import("./actions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const errors = messages.account.apiKeys.errors;

function backend(response: () => Response) {
  const asked: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    return response();
  }) as unknown as typeof fetch;
  return asked;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return undefined;
}

test("creating a key sends the password and hands the key back to the form, once", async () => {
  const asked = backend(() =>
    Response.json({ id: "5", key: "sermo_new", referenceId: "7" }),
  );
  refreshed = 0;
  const state = await issueKey(null, form({ actorPassword: "right-password" }));
  expect(state).toEqual({ key: "sermo_new" });
  expect(refreshed).toBe(1);
  expect(asked).toEqual([
    {
      url: "http://127.0.0.1:8787/api/auth/api-key/create",
      body: { password: "right-password", replace: false },
    },
  ]);
});

test("replacing asks the backend to end the old key in the same request", async () => {
  const asked = backend(() => Response.json({ id: "6", key: "sermo_next" }));
  const state = await issueKey(
    null,
    form({ actorPassword: "right-password", replace: "1" }),
  );
  expect(state).toEqual({ key: "sermo_next" });
  expect(asked[0].body).toEqual({ password: "right-password", replace: true });
});

test("no password is refused on its field before the backend is asked", async () => {
  const asked = backend(() => Response.json({}));
  expect(await issueKey(null, form({}))).toEqual({
    fields: { actorPassword: errors.required },
  });
  expect(asked).toEqual([]);
});

test("a wrong password comes back on the password field, with no key", async () => {
  backend(() =>
    Response.json(
      { code: "INVALID_PASSWORD", message: "Invalid password" },
      { status: 403 },
    ),
  );
  expect(await issueKey(null, form({ actorPassword: "wrong" }))).toEqual({
    fields: { actorPassword: errors.wrongPassword },
  });
});

test("a second key is refused with its own message, and the page is read again to list it", async () => {
  backend(() => Response.json({ code: "API_KEY_EXISTS" }, { status: 409 }));
  refreshed = 0;
  expect(await issueKey(null, form({ actorPassword: "right" }))).toEqual({
    error: errors.exists,
  });
  expect(refreshed).toBe(1);
});

test("too many attempts say so", async () => {
  backend(() => Response.json({ code: "TOO_MANY_ATTEMPTS" }, { status: 429 }));
  expect(await issueKey(null, form({ actorPassword: "right" }))).toEqual({
    error: errors.rateLimited,
  });
});

test("a dead session is sent to sign in, whichever code says so", async () => {
  backend(() =>
    Response.json({ code: "UNAUTHORIZED_SESSION" }, { status: 401 }),
  );
  expect(
    await redirectedTo(() => issueKey(null, form({ actorPassword: "right" }))),
  ).toMatch(/^NEXT_REDIRECT;[a-z]+;\/login;/);
  backend(() => Response.json({ code: "UNAUTHORIZED" }, { status: 401 }));
  expect(
    await redirectedTo(() => issueKey(null, form({ actorPassword: "right" }))),
  ).toMatch(/^NEXT_REDIRECT;[a-z]+;\/login;/);
  expect(await redirectedTo(() => revokeKey(null, form({ key: "5" })))).toMatch(
    /^NEXT_REDIRECT;[a-z]+;\/login;/,
  );
});

test("revoking sends the key's id and goes back to the page with a notice", async () => {
  const asked = backend(() => Response.json({ success: true }));
  expect(await redirectedTo(() => revokeKey(null, form({ key: "5" })))).toMatch(
    /^NEXT_REDIRECT;[a-z]+;\/account\/api\?notice=revoked;/,
  );
  expect(asked).toEqual([
    {
      url: "http://127.0.0.1:8787/api/auth/api-key/delete",
      body: { keyId: "5" },
    },
  ]);
});

test("a key already gone goes back to the page; another refusal stays on the form", async () => {
  backend(() => Response.json({ code: "KEY_NOT_FOUND" }, { status: 404 }));
  expect(await redirectedTo(() => revokeKey(null, form({ key: "5" })))).toMatch(
    /^NEXT_REDIRECT;[a-z]+;\/account\/api;/,
  );
  backend(() => Response.json({}, { status: 500 }));
  expect(await revokeKey(null, form({ key: "5" }))).toEqual({
    error: errors.generic,
  });
});
