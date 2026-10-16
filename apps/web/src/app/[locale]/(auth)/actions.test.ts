import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { HYDRATED_FIELD } from "@/app/[locale]/(auth)/native-form";
import { messages } from "@/i18n/messages";
import { consentCookieValue } from "@/lib/consent/account";
import { parseChoice } from "@/lib/consent/state";
import { siteBody } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";
import { onTheWire } from "../../../../tests/wire-cookies";

const realFetch = globalThis.fetch;
const written: Record<string, unknown>[] = [];
// The cookies the visitor came with, and the names an action removed.
const jar = new Map<string, string>();
const removed: unknown[] = [];
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
    delete: (name: unknown) => removed.push(name),
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
  europeOnly = false;
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
// The site shows its banner in Europe only, and the backend places every visitor outside it.
let europeOnly = false;
// Every request the actions make besides the ones for the consent and the site, which are answered
// from the variables above and counted apart.
const consentCalls: { method: string; body: unknown }[] = [];

function backend(response: () => Response) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (url.endsWith("/api/v1/site"))
      return Response.json(
        siteBody({
          cookiePolicyVersion: siteVersion,
          cookieBannerOutsideEu: !europeOnly,
        }),
      );
    if (url.endsWith("/api/v1/consent/banner"))
      return Response.json({ show: false });
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

// The form as the hydrated page sends it: its hidden field says so (see `native-form.ts`).
function form(fields: Record<string, string>) {
  const data = new FormData();
  data.set(HYDRATED_FIELD, "1");
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

// The form as the browser sends it when the page's script has not taken over: the field is empty.
function nativeForm(fields: Record<string, string>) {
  const data = form(fields);
  data.set(HYDRATED_FIELD, "");
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

test("an address signs in by email, a name with an @ and no dot after it by username", async () => {
  for (const [typed, endpoint] of [
    ["ann@example.test", "sign-in/email"],
    ["$kyw@lker", "sign-in/username"],
    ["#Eríos_@ls93", "sign-in/username"],
  ]) {
    const asked = backend(() =>
      Response.json({ code: "INVALID_USERNAME_OR_PASSWORD" }, { status: 401 }),
    );
    await login(
      { error: "", username: "" },
      form({ username: typed, password: "wrong" }),
    );
    expect(asked).toEqual([`http://127.0.0.1:8787/api/auth/${endpoint}`]);
  }
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

test("the sign-up says the terms and rules were accepted; without the box nothing is sent", async () => {
  backend(SIGNED_UP);
  await signUp();
  expect(bodies[0]).toMatchObject({ acceptTerms: true });
  bodies.length = 0;
  const state = await register(
    { error: "", username: "" },
    form({
      username: "ann",
      email: "ann@example.test",
      password: "right-password",
    }),
  );
  expect(state.error).toBe(messages.auth.actions.errors.termsRequired);
  expect(bodies).toEqual([]);
});

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
    {
      method: "PUT",
      // With the time the visitor chose, not the time they signed in.
      body: {
        categories: ["embeds"],
        policyVersion: 1,
        decidedAt: "2026-10-01T10:00:00.000Z",
      },
    },
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
  // As the browser receives it, which is what the library and the server read back.
  const { raw } = onTheWire(cookie as never);
  expect(parseChoice(raw, 1)).toEqual({
    accepted: ["analytics", "referrals"],
    at: Date.parse("2026-10-02T10:00:00.000Z"),
  });
  expect(JSON.parse(decodeURIComponent(raw))).toMatchObject({
    categories: ["necessary", "analytics", "referrals"],
    revision: 1,
  });
  // Not the 3rd or any other version.
  expect(parseChoice(raw, 2)).toBeNull();
});

test("on a site with a host name the cookie is written for that host, as the library writes its own, and Secure over https", async () => {
  const before = process.env.SERMO_PUBLIC_URL;
  process.env.SERMO_PUBLIC_URL = "https://forum.example.test";
  try {
    record = accountChoice(1, "2026-10-02T10:00:00.000Z", "embeds");
    backend(SIGNED_UP);
    await signIn();
    const { header } = onTheWire(consentCookieWritten() as never);
    expect(header).toContain("Domain=forum.example.test");
    expect(header).toContain("Secure");
  } finally {
    if (before === undefined) delete process.env.SERMO_PUBLIC_URL;
    else process.env.SERMO_PUBLIC_URL = before;
  }
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
    {
      method: "PUT",
      body: {
        categories: [],
        policyVersion: 3,
        decidedAt: "2026-10-03T10:00:00.000Z",
      },
    },
  ]);
});

test("when both hold a choice and they differ, the account's stands, whoever chose last and whatever the clocks say", async () => {
  record = accountChoice(1, "2026-10-02T10:00:00.000Z", "analytics");
  backend(SIGNED_UP);
  for (const at of [
    "2026-10-01T10:00:00Z",
    "2026-10-05T10:00:00Z",
    "2031-01-01T00:00:00Z",
  ]) {
    written.length = 0;
    consentCalls.length = 0;
    jar.set("forum_consent", choiceCookie(1, at, "embeds"));
    await signIn();
    expect(
      parseChoice(onTheWire(consentCookieWritten() as never).raw, 1)?.accepted,
      at,
    ).toEqual(["analytics"]);
    expect(
      consentCalls.map((call) => call.method),
      at,
    ).toEqual(["GET"]);
  }
  // Equal choices need nothing.
  written.length = 0;
  consentCalls.length = 0;
  record = accountChoice(1, "2026-10-06T10:00:00.000Z", "embeds");
  await signIn();
  expect(consentCalls.map((call) => call.method)).toEqual(["GET"]);
  expect(consentCookieWritten()).toBeUndefined();
});

test("after the account's choice is adopted the next page is a full load, so the running banner reads it", async () => {
  record = accountChoice(1, "2026-10-02T10:00:00.000Z", "analytics");
  backend(SIGNED_UP);
  const state = await login(
    { error: "", username: "" },
    form({ username: "ann", password: "right", next: "/threads/3" }),
  );
  expect(state).toEqual({ error: "", username: "ann", assign: "/threads/3" });
  // Nothing adopted, an ordinary redirect as before.
  record = null;
  written.length = 0;
  expect(await signIn()).toMatch(/^NEXT_REDIRECT/);
});

test("registering with a choice adopted from the account is a full load too", async () => {
  record = accountChoice(1, "2026-10-02T10:00:00.000Z", "embeds");
  backend(SIGNED_UP);
  const state = await register(
    { error: "", username: "" },
    form({
      username: "ann",
      email: "ann@example.test",
      password: "right-password",
      terms: "on",
    }),
  );
  expect(state).toEqual({ error: "", username: "ann", assign: "/" });
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

test("a refusal from an earlier policy version is not used as acceptance when registering outside Europe", async () => {
  siteVersion = 2;
  europeOnly = true;
  try {
    // Accepted referrals at version 1, then the site asked again: the visitor is asked, not
    // treated as accepting, so the held referral cookie is not used (the form's referrer is).
    jar.set(
      "forum_consent",
      choiceCookie(1, "2026-10-01T10:00:00Z", "referrals"),
    );
    jar.set("forum_ref", "7");
    backend(SIGNED_UP);
    await signUp({ ref: "12" });
    expect(bodies[0]).toMatchObject({ ref: 12 });
  } finally {
    europeOnly = false;
  }
});

// A cookie written from another member's account (it carries the mark) and left in the browser.
const memberACookie = () =>
  onTheWire({
    name: "forum_consent",
    value: consentCookieValue(
      {
        categories: ["analytics", "embeds"],
        policyVersion: 1,
        decidedAt: "2026-10-01T10:00:00.000Z",
      },
      "en",
      "id-a",
    ),
  }).raw;

test("another member's adopted choice is never saved onto this member's account: with no record of their own it is removed and they are asked", async () => {
  jar.set("forum_consent", memberACookie());
  backend(SIGNED_UP);
  const state = await login(
    { error: "", username: "" },
    form({ username: "ann", password: "right" }),
  );
  expect(consentCalls.map((call) => call.method)).toEqual(["GET"]);
  expect(removed).toEqual([{ name: "forum_consent", path: "/" }]);
  // The cookie the running banner holds is gone: the next page is a full load.
  expect(state).toMatchObject({ assign: "/" });
});

test("another member's adopted choice gives way to this member's own record", async () => {
  jar.set("forum_consent", memberACookie());
  record = accountChoice(1, "2026-10-02T10:00:00.000Z", "referrals");
  backend(SIGNED_UP);
  const state = await login(
    { error: "", username: "" },
    form({ username: "ann", password: "right" }),
  );
  expect(consentCalls.map((call) => call.method)).toEqual(["GET"]);
  expect(
    parseChoice(onTheWire(consentCookieWritten() as never).raw, 1)?.accepted,
  ).toEqual(["referrals"]);
  expect(state).toMatchObject({ assign: "/" });
});

test("a cookie the banner wrote in this browser is still the visitor's own choice and is saved", async () => {
  jar.set("forum_consent", choiceCookie(1, "2026-10-01T10:00:00Z", "embeds"));
  backend(SIGNED_UP);
  await signIn();
  expect(consentCalls.map((call) => call.method)).toEqual(["GET", "PUT"]);
  expect(removed).toEqual([]);
});

// A form the browser sent by itself (no script yet) cannot be answered with a state: nothing draws
// it. Every answer is a redirect to a page, and the refusals name themselves in the address.
async function redirectOf(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return "no redirect";
}
const state = { error: "", username: "" };

test("a sign-in sent before the page's script ran goes to the page asked for, also when a choice is adopted", async () => {
  record = accountChoice(1, "2026-10-02T10:00:00.000Z", "analytics");
  backend(SIGNED_UP);
  const sent = { username: "ann", password: "right", next: "/threads/3" };
  expect(await redirectOf(() => login(state, nativeForm(sent)))).toMatch(
    /^NEXT_REDIRECT;[a-z]+;\/threads\/3;/,
  );
  // The hydrated form is told to load the page itself: the banner running in it reads the choice.
  expect(await login(state, form(sent))).toEqual({
    error: "",
    username: "ann",
    assign: "/threads/3",
  });
});

test("a sign-up sent before the page's script ran goes to the home page, also when a choice is adopted", async () => {
  record = accountChoice(1, "2026-10-02T10:00:00.000Z", "embeds");
  backend(SIGNED_UP);
  const sent = {
    username: "ann",
    email: "ann@example.test",
    password: "right-password",
    terms: "on",
  };
  expect(await redirectOf(() => register(state, nativeForm(sent)))).toMatch(
    /^NEXT_REDIRECT;[a-z]+;\/;/,
  );
});

test("a refused sign-in sent before the page's script ran goes back to the form with the refusal named", async () => {
  backend(() =>
    Response.json({ code: "INVALID_USERNAME_OR_PASSWORD" }, { status: 401 }),
  );
  expect(
    await redirectOf(() =>
      login(state, nativeForm({ username: "ann", password: "wrong" })),
    ),
  ).toContain(";/login?refused=invalidCredentials;");
  // The page asked for is kept.
  expect(
    await redirectOf(() =>
      login(
        state,
        nativeForm({ username: "ann", password: "wrong", next: "/threads/3" }),
      ),
    ),
  ).toContain(";/login?next=%2Fthreads%2F3&refused=invalidCredentials;");
  // Nothing typed at all.
  expect(
    await redirectOf(() => login(state, nativeForm({ username: "" }))),
  ).toContain(";/login?refused=invalidCredentials;");
});

test("the limiter's refusal of a sign-in sent before the page's script ran is named too", async () => {
  backend(() => Response.json({ code: "RATE_LIMITED" }, { status: 429 }));
  expect(
    await redirectOf(() =>
      login(state, nativeForm({ username: "ann", password: "right" })),
    ),
  ).toContain(";/login?refused=rateLimited;");
  // The hydrated form is told in words.
  expect(
    await login(state, form({ username: "ann", password: "right" })),
  ).toEqual({
    error: messages.auth.actions.errors.rateLimited,
    username: "ann",
  });
});

test("a refused sign-up sent before the page's script ran goes back to the form and keeps the referrer", async () => {
  backend(() =>
    Response.json({ code: "USERNAME_IS_ALREADY_TAKEN" }, { status: 422 }),
  );
  const sent = {
    username: "ann",
    email: "ann@example.test",
    password: "right-password",
    terms: "on",
    ref: "42",
  };
  expect(await redirectOf(() => register(state, nativeForm(sent)))).toContain(
    ";/register?ref=42&refused=usernameTaken;",
  );
  expect(
    await redirectOf(() =>
      register(state, nativeForm({ ...sent, terms: "", ref: "" })),
    ),
  ).toContain(";/register?refused=termsRequired;");
  expect(
    await redirectOf(() => register(state, nativeForm({ username: "ann" }))),
  ).toContain(";/register?refused=passwordRequired;");
});
