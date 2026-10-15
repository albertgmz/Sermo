import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { parseChoice } from "@/lib/consent/state";
import { siteBody } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;
const written: Record<string, unknown>[] = [];
// The cookies the visitor came with, and the names an action removed.
const jar = new Map<string, string>();
const removed: string[] = [];
const bodies: Record<string, unknown>[] = [];
const ACCEPTED = encodeURIComponent(
  JSON.stringify({ categories: ["necessary", "referrals"], revision: 1 }),
);

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
// The consent reader asks for the site, which is cached in the app and not here.
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    set: (cookie: Record<string, unknown>) => written.push(cookie),
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
    has: (name: string) => jar.has(name),
    delete: (name: string) => removed.push(name),
    toString: () => "",
  }),
}));

const { login, register } = await import("./actions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});
beforeEach(() => {
  record = null;
  siteVersion = 1;
  consentCalls.length = 0;
  written.length = 0;
  removed.length = 0;
  bodies.length = 0;
  jar.clear();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// What the account says about the cookie choice (`consent.mine`), and the version the site is on.
let record: Record<string, unknown> | null = null;
let siteVersion = 1;
// Every request the actions make besides the ones for the consent and the site, which are answered
// from the variables above and counted apart.
const consentCalls: { method: string; body: unknown }[] = [];

function backend(response: () => Response) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (url.endsWith("/api/v1/site"))
      return Response.json(siteBody({ cookiePolicyVersion: siteVersion }));
    if (url.endsWith("/api/v1/consent")) {
      consentCalls.push({ method: init?.method ?? "GET", body });
      return init?.method === "PUT"
        ? Response.json({
            record: { ...body, decidedAt: new Date().toISOString() },
          })
        : Response.json({ record });
    }
    asked.push(url);
    bodies.push(body);
    return response();
  }) as unknown as typeof fetch;
  return asked;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

test("wrong credentials come back as the form's message with the username kept, and no cookie", async () => {
  const asked = backend(() =>
    Response.json({ code: "INVALID_USERNAME_OR_PASSWORD" }, { status: 401 }),
  );
  const state = await login(
    { error: "", username: "" },
    form({ username: "ann", password: "wrong" }),
  );
  expect(state).toEqual({
    error: messages.auth.actions.errors.invalidCredentials,
    username: "ann",
  });
  expect(asked).toEqual(["http://127.0.0.1:8787/api/auth/sign-in/username"]);
  expect(written).toEqual([]);
});

test("a missing field is refused without asking the backend", async () => {
  const asked = backend(() => Response.json({}));
  const state = await login(
    { error: "", username: "" },
    form({ username: "ann", password: "" }),
  );
  expect(state.error).toBe(messages.auth.actions.errors.invalidCredentials);
  expect(asked).toEqual([]);
});

test("signing in delivers the session cookie and goes back to the page asked for", async () => {
  backend(
    () =>
      new Response("{}", {
        status: 200,
        headers: { "set-cookie": "sermo.session_token=tok; Path=/; HttpOnly" },
      }),
  );
  let digest = "";
  try {
    await login(
      { error: "", username: "" },
      form({ username: "ann", password: "right", next: "/threads/3" }),
    );
  } catch (error) {
    digest = String((error as { digest?: unknown }).digest);
  }
  expect(digest).toMatch(/^NEXT_REDIRECT;[a-z]+;\/threads\/3;/);
  expect(written).toEqual([
    { name: "sermo.session_token", value: "tok", path: "/", httpOnly: true },
  ]);
});

const SIGNED_UP = () =>
  new Response("{}", {
    status: 200,
    headers: { "set-cookie": "sermo.session_token=tok; Path=/; HttpOnly" },
  });

async function signUp(fields: Record<string, string> = {}) {
  let digest = "";
  try {
    await register(
      { error: "", username: "" },
      form({
        username: "ann",
        email: "ann@example.test",
        password: "right-password",
        terms: "on",
        ...fields,
      }),
    );
  } catch (error) {
    digest = String((error as { digest?: unknown }).digest);
  }
  return digest;
}

test("registering from a ?ref= link sends the referrer with the sign-up", async () => {
  backend(SIGNED_UP);
  expect(await signUp({ ref: "12" })).toMatch(/^NEXT_REDIRECT;[a-z]+;\/;/);
  // The sign-up alone carries it: nothing else is asked of the backend.
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ username: "ann", ref: 12 });
  expect(removed).toEqual([]);
});

test("registering with the referral cookie sends its referrer and then drops the cookie", async () => {
  jar.set("forum_consent", ACCEPTED);
  jar.set("forum_ref", "7");
  backend(SIGNED_UP);
  await signUp();
  expect(bodies[0]).toMatchObject({ ref: 7 });
  expect(removed).toEqual(["forum_ref"]);
});

test("the first referrer wins: the cookie over the form", async () => {
  jar.set("forum_consent", ACCEPTED);
  jar.set("forum_ref", "7");
  backend(SIGNED_UP);
  await signUp({ ref: "12" });
  expect(bodies[0]).toMatchObject({ ref: 7 });
});

test("a cookie that names no member does not hide the referrer of the form", async () => {
  jar.set("forum_consent", ACCEPTED);
  jar.set("forum_ref", "junk");
  backend(SIGNED_UP);
  await signUp({ ref: "12" });
  expect(bodies[0]).toMatchObject({ ref: 12 });
});

test("without a referrer, or with an invalid one, the sign-up carries none", async () => {
  for (const ref of [undefined, "", "0", "-1", "abc", "1e2", "1.5"]) {
    bodies.length = 0;
    backend(SIGNED_UP);
    await signUp(ref === undefined ? {} : { ref });
    expect(bodies[0], String(ref)).not.toHaveProperty("ref");
  }
});

test("a cookie the visitor no longer accepts is not used, the form's referrer is", async () => {
  jar.set("forum_ref", "7");
  backend(SIGNED_UP);
  await signUp({ ref: "12" });
  expect(bodies[0]).toMatchObject({ ref: 12 });
  bodies.length = 0;
  await signUp();
  expect(bodies[0]).not.toHaveProperty("ref");
});

test("a sign-up the backend refuses keeps the cookie", async () => {
  jar.set("forum_consent", ACCEPTED);
  jar.set("forum_ref", "7");
  backend(() =>
    Response.json({ code: "USER_ALREADY_EXISTS" }, { status: 422 }),
  );
  const state = await register(
    { error: "", username: "" },
    form({
      username: "ann",
      email: "ann@example.test",
      password: "right-password",
      terms: "on",
    }),
  );
  expect(state.error).toBe(messages.auth.actions.errors.emailTaken);
  expect(removed).toEqual([]);
});

test("a site that asks for email confirmation sends the referrer too", async () => {
  backend(() => new Response("{}", { status: 200 }));
  expect(await signUp({ ref: "12" })).toMatch(
    /^NEXT_REDIRECT;[a-z]+;\/login\?registered=1;/,
  );
  expect(bodies[0]).toMatchObject({ ref: 12 });
});

// The choice kept on the account and the one in the browser come together at sign-in.
const choiceCookie = (revision: number, at: string, ...categories: string[]) =>
  encodeURIComponent(
    JSON.stringify({
      categories: ["necessary", ...categories],
      revision,
      consentTimestamp: at,
      lastConsentTimestamp: at,
    }),
  );
const accountChoice = (
  policyVersion: number,
  decidedAt: string,
  ...categories: string[]
) => ({ categories, policyVersion, decidedAt });
const consentCookieWritten = () =>
  written.find((cookie) => cookie.name === "forum_consent");

async function signIn() {
  try {
    await login(
      { error: "", username: "" },
      form({ username: "ann", password: "right" }),
    );
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return undefined;
}

test("a choice made as a guest is saved on the account at sign-in when the account has none", async () => {
  jar.set("forum_consent", choiceCookie(1, "2026-10-01T10:00:00Z", "embeds"));
  backend(SIGNED_UP);
  expect(await signIn()).toMatch(/^NEXT_REDIRECT/);
  expect(consentCalls).toEqual([
    { method: "GET", body: {} },
    { method: "PUT", body: { categories: ["embeds"], policyVersion: 1 } },
  ]);
  expect(consentCookieWritten()).toBeUndefined();
});

test("a device with no choice takes the account's current choice: the consent cookie is written from the record", async () => {
  record = accountChoice(
    1,
    "2026-10-02T10:00:00.000Z",
    "analytics",
    "referrals",
  );
  backend(SIGNED_UP);
  await signIn();
  expect(consentCalls.map((call) => call.method)).toEqual(["GET"]);
  const cookie = consentCookieWritten();
  expect(cookie).toMatchObject({ path: "/", sameSite: "lax" });
  // The banner library reads it as its own: current version, the record's categories and time.
  expect(parseChoice(String(cookie?.value), 1)).toEqual({
    accepted: ["analytics", "referrals"],
    at: Date.parse("2026-10-02T10:00:00.000Z"),
  });
  // Not the 3rd or any other version.
  expect(parseChoice(String(cookie?.value), 2)).toBeNull();
});

test("a record of an older policy version is no choice: nothing is adopted, and the device's choice replaces it", async () => {
  siteVersion = 3;
  record = accountChoice(2, "2026-10-02T10:00:00.000Z", "analytics");
  backend(SIGNED_UP);
  await signIn();
  expect(consentCookieWritten()).toBeUndefined();
  expect(consentCalls.map((call) => call.method)).toEqual(["GET"]);
  consentCalls.length = 0;
  jar.set("forum_consent", choiceCookie(3, "2026-10-03T10:00:00Z"));
  await signIn();
  expect(consentCalls).toEqual([
    { method: "GET", body: {} },
    { method: "PUT", body: { categories: [], policyVersion: 3 } },
  ]);
});

test("when both hold a choice and they differ, the later one wins", async () => {
  record = accountChoice(1, "2026-10-02T10:00:00.000Z", "analytics");
  jar.set("forum_consent", choiceCookie(1, "2026-10-01T10:00:00Z", "embeds"));
  backend(SIGNED_UP);
  await signIn();
  expect(
    parseChoice(String(consentCookieWritten()?.value), 1)?.accepted,
  ).toEqual(["analytics"]);
  expect(consentCalls.map((call) => call.method)).toEqual(["GET"]);
  consentCalls.length = 0;
  written.length = 0;
  jar.set("forum_consent", choiceCookie(1, "2026-10-05T10:00:00Z", "embeds"));
  await signIn();
  expect(consentCalls.map((call) => call.method)).toEqual(["GET", "PUT"]);
  expect(consentCookieWritten()).toBeUndefined();
  // Equal choices need nothing.
  consentCalls.length = 0;
  record = accountChoice(1, "2026-10-06T10:00:00.000Z", "embeds");
  await signIn();
  expect(consentCalls.map((call) => call.method)).toEqual(["GET"]);
});

test("a new member's choice as a guest is saved when the sign-up signs them in, not when it does not", async () => {
  jar.set(
    "forum_consent",
    choiceCookie(1, "2026-10-01T10:00:00Z", "referrals"),
  );
  backend(SIGNED_UP);
  await signUp();
  expect(consentCalls.map((call) => call.method)).toEqual(["GET", "PUT"]);
  consentCalls.length = 0;
  // Mail confirmation: no session yet, so no account to save on.
  backend(() => new Response("{}", { status: 200 }));
  await signUp();
  expect(consentCalls).toEqual([]);
});

test("a failed sign-in touches no consent", async () => {
  jar.set("forum_consent", choiceCookie(1, "2026-10-01T10:00:00Z", "embeds"));
  backend(() =>
    Response.json({ code: "INVALID_USERNAME_OR_PASSWORD" }, { status: 401 }),
  );
  await login(
    { error: "", username: "" },
    form({ username: "ann", password: "wrong" }),
  );
  expect(consentCalls).toEqual([]);
});

test("a failure while bringing the choices together never costs the sign-in", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    jar.set("forum_consent", choiceCookie(1, "2026-10-01T10:00:00Z", "embeds"));
    backend(SIGNED_UP);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) =>
      String(url).endsWith("/api/v1/consent")
        ? new Response("down", { status: 503 })
        : realFetch(url, init)) as unknown as typeof fetch;
    expect(await signIn()).toMatch(/^NEXT_REDIRECT/);
    expect(
      written.some((cookie) => cookie.name === "sermo.session_token"),
    ).toBe(true);
  } finally {
    console.error = quiet;
  }
});

test("the session that was just opened speaks for the member, not the cookies the visitor came with", async () => {
  const seen: (string | null)[] = [];
  jar.set("forum_consent", choiceCookie(1, "2026-10-01T10:00:00Z", "embeds"));
  backend(SIGNED_UP);
  const inner = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/api/v1/consent"))
      seen.push(new Headers(init?.headers).get("cookie"));
    return inner(url, init);
  }) as unknown as typeof fetch;
  await signIn();
  expect(seen).toEqual(["sermo.session_token=tok", "sermo.session_token=tok"]);
});
