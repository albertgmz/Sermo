import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
const before = process.env.SERMO_PUBLIC_URL;
const SITE = "https://forum.example.test";
const SESSION = "__Secure-sermo.session_token=tok";
// The headers of the request being answered, as `next/headers` hands them to the route's helpers.
let sent = new Headers();
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => sent,
  cookies: async () => ({ get: () => undefined }),
}));
const { POST } = await import("./route");
const { LANGUAGE_SWITCHER_ID } = await import(
  "@/components/layout/language-switcher"
);

type Asked = { method: string; path: string; body: unknown };
let asked: Asked[] = [];
// What the backend answers: auth.me for a guest or a member, and the preferences write.
let backend = {
  member: false,
  me: undefined as (() => Response) | undefined,
  saved: undefined as (() => Response) | undefined,
};

const PREFERENCES = {
  watchOnCreate: "none",
  watchOnReply: "none",
  language: "es",
  profileViewPrivacy: "everyone",
  profilePostPrivacy: "members",
  keyboardShortcuts: true,
  homeTab: null,
  feedView: "cards",
  theme: null,
  showOnline: true,
};

beforeEach(() => {
  process.env.SERMO_PUBLIC_URL = SITE;
  asked = [];
  backend = { member: false, me: undefined, saved: undefined };
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    asked.push({
      method: String(init.method ?? "GET"),
      path,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    if (path === "/api/v1/me")
      return backend.me?.() ?? Response.json(viewerBody(backend.member));
    return backend.saved?.() ?? Response.json(PREFERENCES);
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (before === undefined) delete process.env.SERMO_PUBLIC_URL;
  else process.env.SERMO_PUBLIC_URL = before;
});

// The footer's form, posted from `referer` (null: the browser sent none).
function switchTo(
  language: string | null,
  {
    origin = SITE as string | null,
    referer = `${SITE}/threads/12-hello?page=2` as string | null,
    cookie = "",
  } = {},
) {
  const headers = new Headers({ host: new URL(SITE).host });
  if (origin !== null) headers.set("origin", origin);
  if (referer !== null) headers.set("referer", referer);
  if (cookie) headers.set("cookie", cookie);
  sent = headers;
  const body = new FormData();
  if (language !== null) body.set("language", language);
  return POST(
    new Request("http://127.0.0.1:4200/language", {
      method: "POST",
      headers,
      body,
    }),
  );
}

const languageCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .filter((cookie) => cookie.startsWith("forum_locale="));

test("a guest's choice is written to the language cookie and the same address is loaded again", async () => {
  for (const language of ["es", "en"]) {
    const response = await switchTo(language);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `${SITE}/threads/12-hello?page=2#language`,
    );
    const [cookie, ...more] = languageCookie(response);
    expect(more).toEqual([]);
    const attributes = cookie.split("; ");
    expect(attributes[0]).toBe(`forum_locale=${language}`);
    expect(attributes).toContain("Path=/");
    expect(attributes).toContain(`Max-Age=${60 * 60 * 24 * 365}`);
    expect(attributes.map((part) => part.toLowerCase())).toContain(
      "samesite=lax",
    );
    expect(attributes).toContain("Secure");
    // Readable by scripts on purpose: `LocaleSync` compares it with the saved language.
    expect(attributes).not.toContain("HttpOnly");
  }
  // Nothing is saved for a guest.
  expect(asked.filter((call) => call.path !== "/api/v1/me")).toEqual([]);
});

test("the cookie is Secure only on a site served over https", async () => {
  process.env.SERMO_PUBLIC_URL = "http://forum.example.test";
  const response = await switchTo("es", {
    origin: "http://forum.example.test",
    referer: "http://forum.example.test/members",
  });
  expect(response.headers.get("location")).toBe(
    "http://forum.example.test/members#language",
  );
  expect(languageCookie(response)[0].split("; ")).not.toContain("Secure");
});

test("a member's choice is saved on their account first, then written to the cookie", async () => {
  backend.member = true;
  const response = await switchTo("es", { cookie: SESSION });
  expect(asked.at(-1)).toEqual({
    method: "PATCH",
    path: "/api/v1/me/preferences",
    body: { language: "es" },
  });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    `${SITE}/threads/12-hello?page=2#language`,
  );
  expect(languageCookie(response)[0]).toStartWith("forum_locale=es;");
});

test("when the account does not take the choice, or the session cannot be confirmed, nothing changes", async () => {
  backend.member = true;
  backend.saved = () =>
    Response.json(
      { error: { code: "internal", message: "down" } },
      { status: 503 },
    );
  const refused = await switchTo("es", { cookie: SESSION });
  expect(refused.status).toBe(303);
  expect(refused.headers.get("location")).toBe(
    `${SITE}/threads/12-hello?page=2#language`,
  );
  expect(languageCookie(refused)).toEqual([]);
  // A session auth.me could not check: a member cannot be told from a guest, so neither the
  // account nor the cookie is written.
  asked = [];
  backend.me = () =>
    Response.json(
      { error: { code: "rate_limited", message: "slow down" } },
      { status: 429 },
    );
  const unconfirmed = await switchTo("es", { cookie: SESSION });
  expect(unconfirmed.status).toBe(303);
  expect(languageCookie(unconfirmed)).toEqual([]);
  expect(asked.filter((call) => call.method !== "GET")).toEqual([]);
});

test("a switch posted from another site, or with no origin, is refused and nothing is written", async () => {
  for (const origin of [
    "https://evil.example",
    "http://forum.example.test",
    null,
  ]) {
    const response = await switchTo("es", { origin });
    expect(response.status, String(origin)).toBe(403);
    expect(languageCookie(response)).toEqual([]);
  }
  expect(asked).toEqual([]);
});

test("a language the site does not speak, or none, is refused", async () => {
  for (const language of ["fr", "", "ES", null]) {
    const response = await switchTo(language);
    expect(response.status, String(language)).toBe(400);
    expect(languageCookie(response)).toEqual([]);
  }
  expect(asked).toEqual([]);
});

test("the browser is only sent back to a path of this site, never to another one", async () => {
  for (const referer of [
    "https://evil.example/threads/1",
    "http://forum.example.test.evil.example/",
    `${SITE}//evil.example/x`,
    `${SITE}/\\evil.example/x`,
    `${SITE}/login`,
    "not a url",
    null,
  ]) {
    const response = await switchTo("es", { referer });
    expect(response.status, String(referer)).toBe(303);
    expect(response.headers.get("location"), String(referer)).toBe(
      `${SITE}/#language`,
    );
  }
});

test("the page loads again scrolled to the switcher the reader used, not at its top", async () => {
  const response = await switchTo("es", {
    referer: `${SITE}/threads/12-hello?page=9`,
  });
  const back = new URL(String(response.headers.get("location")));
  expect(back.pathname + back.search).toBe("/threads/12-hello?page=9");
  // The id the footer's form carries (its own test checks the form has it).
  expect(back.hash).toBe(`#${LANGUAGE_SWITCHER_ID}`);
});

test("System removes the language cookie, so the browser's language decides again; a guest saves nothing", async () => {
  const response = await switchTo("system", { cookie: "forum_locale=es" });
  expect(response.status).toBe(303);
  const [cookie, ...more] = languageCookie(response);
  expect(more).toEqual([]);
  expect(cookie).toStartWith("forum_locale=;");
  expect(cookie).toContain("Expires=Thu, 01 Jan 1970");
  expect(asked.filter((call) => call.path !== "/api/v1/me")).toEqual([]);
});

test("for a member System also clears the saved language, or the next page would put the cookie back", async () => {
  backend.member = true;
  const response = await switchTo("system", { cookie: SESSION });
  expect(asked.at(-1)).toEqual({
    method: "PATCH",
    path: "/api/v1/me/preferences",
    body: { language: null },
  });
  expect(languageCookie(response)[0]).toContain("Expires=Thu, 01 Jan 1970");
});
