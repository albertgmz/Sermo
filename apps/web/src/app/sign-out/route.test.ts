import { afterEach, beforeEach, expect, mock, test } from "bun:test";

const realFetch = globalThis.fetch;
const before = process.env.SERMO_PUBLIC_URL;
let consentCookie: string | undefined;
const cookieSets: Record<string, unknown>[] = [];
const cookieDeletes: unknown[] = [];
let asked: string[] = [];
// What the backend answers the sign-out with.
let answer: () => Response = () => expiring(200, "{}");
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=tok" }),
  cookies: async () => ({
    set: (cookie: Record<string, unknown>) => cookieSets.push(cookie),
    get: (name: string) =>
      name === "forum_consent" && consentCookie !== undefined
        ? { name, value: consentCookie }
        : undefined,
    delete: (cookie: unknown) => cookieDeletes.push(cookie),
  }),
}));
const { POST } = await import("./route");
const { SIGNED_OUT_COOKIE } = await import("@/lib/signed-out");

beforeEach(() => {
  process.env.SERMO_PUBLIC_URL = "https://forum.example.test";
  asked = [];
  answer = () => expiring(200, "{}");
  globalThis.fetch = (async (url: string) => {
    asked.push(new URL(url).pathname);
    return answer();
  }) as unknown as typeof fetch;
});

// An answer that expires the session cookie, as Better Auth's sign-out does.
function expiring(status: number, body: string) {
  const headers = new Headers();
  headers.append(
    "set-cookie",
    "__Secure-sermo.session_token=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax",
  );
  return new Response(body, { status, headers });
}
afterEach(() => {
  globalThis.fetch = realFetch;
  consentCookie = undefined;
  cookieSets.length = 0;
  cookieDeletes.length = 0;
  if (before === undefined) delete process.env.SERMO_PUBLIC_URL;
  else process.env.SERMO_PUBLIC_URL = before;
});

// `fetchSite` is the browser's `Sec-Fetch-Site`: left out when null, as an older browser does.
const signOutFrom = (origin: string | null, fetchSite: string | null = null) =>
  POST(
    new Request("http://127.0.0.1:4200/sign-out", {
      method: "POST",
      headers: {
        ...(origin === null ? {} : { origin }),
        ...(fetchSite === null ? {} : { "sec-fetch-site": fetchSite }),
      },
    }),
  );

// The consent cookie as the banner library writes it, with what the library keeps under `data`.
const consentCookieWith = (data: unknown) =>
  encodeURIComponent(
    JSON.stringify({ categories: ["necessary"], revision: 1, data }),
  );

test("signing out ends the session, sends the browser home and asks it to clear the cache, not the storage or the cookies", async () => {
  const response = await signOutFrom("https://forum.example.test");
  expect(asked).toEqual(["/api/auth/sign-out"]);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("https://forum.example.test/");
  expect(response.headers.get("clear-site-data")).toBe('"cache"');
  // Better Auth's own expiry of its cookies is passed on.
  expect(cookieSets).toEqual([
    {
      name: "__Secure-sermo.session_token",
      value: "",
      maxAge: 0,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    },
  ]);
});

test("a sign-out posted from another site, or with no origin, is refused and nothing is cleared", async () => {
  for (const origin of [
    "https://evil.example",
    "http://forum.example.test",
    null,
  ]) {
    const response = await signOutFrom(origin);
    expect(response.status, String(origin)).toBe(403);
    expect(response.headers.has("clear-site-data")).toBe(false);
  }
  expect(asked).toEqual([]);
});

test("signing out takes off a consent cookie that was written from the account, for the host it was written for, and only that one", async () => {
  consentCookie = consentCookieWith({ source: "account" });
  await signOutFrom("https://forum.example.test");
  expect(cookieDeletes).toEqual([
    { name: "forum_consent", path: "/", domain: "forum.example.test" },
  ]);
  // A choice made in this browser, or none, stays.
  cookieDeletes.length = 0;
  for (const value of [consentCookieWith(null), undefined]) {
    consentCookie = value;
    await signOutFrom("https://forum.example.test");
  }
  expect(cookieDeletes).toEqual([]);
});

test("a session that was already gone still counts as signed out: the backend's 401 expires the dead cookie", async () => {
  answer = () =>
    expiring(
      401,
      JSON.stringify({ code: "UNAUTHORIZED", message: "Unauthorized" }),
    );
  const response = await signOutFrom("https://forum.example.test");
  expect(response.headers.get("location")).toBe("https://forum.example.test/");
  expect(response.headers.get("clear-site-data")).toBe('"cache"');
});

test("a sign-out the backend could not make clears nothing and lands on the home page's notice", async () => {
  consentCookie = consentCookieWith({ source: "account" });
  for (const fails of [
    () => {
      throw new TypeError("connection refused");
    },
    () =>
      Response.json(
        { code: "RATE_LIMITED", message: "Too many requests" },
        { status: 429 },
      ),
    () => new Response("", { status: 503 }),
  ]) {
    answer = fails;
    const response = await signOutFrom("https://forum.example.test");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://forum.example.test/?notice=signOutFailed",
    );
    expect(response.headers.has("clear-site-data")).toBe(false);
  }
  // The member is still signed in, so the account's consent cookie stays too.
  expect(cookieDeletes).toEqual([]);
});

test("the home page it sends the browser to has no language in its address and the language cookie stays, so the proxy draws it in the visitor's language", async () => {
  const response = await signOutFrom("https://forum.example.test");
  expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/");
  expect(response.headers.get("clear-site-data")).not.toContain("cookies");
  const touched = [
    ...cookieSets.map((cookie) => cookie.name),
    ...cookieDeletes,
  ];
  expect(JSON.stringify(touched)).not.toContain("forum_locale");
});

test("signing out expires the cookie that carries the member's theme to the page script", async () => {
  const response = await signOutFrom("https://forum.example.test");
  const cookie = response.headers
    .getSetCookie()
    .find((line) => line.startsWith("sermo-account-theme="));
  expect(cookie).toContain("sermo-account-theme=;");
  expect(cookie).toContain("Expires=Thu, 01 Jan 1970");
});

test("a form the browser marks as sent from the site's own pages is taken when its Origin is null, missing or another address of the site", async () => {
  for (const origin of ["null", null, "https://www.forum.example.test"]) {
    asked = [];
    const response = await signOutFrom(origin, "same-origin");
    expect(response.status, String(origin)).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://forum.example.test/",
    );
    expect(response.headers.get("clear-site-data")).toBe('"cache"');
    expect(asked).toEqual(["/api/auth/sign-out"]);
  }
});

test("a form from another site is refused whatever its Origin says, and nothing is cleared", async () => {
  for (const [origin, fetchSite] of [
    [null, "cross-site"],
    ["null", "cross-site"],
    ["https://evil.example", "cross-site"],
    ["https://evil.example", null],
    ["null", null],
    // Another host under the same registrable domain is not the site.
    ["https://blog.example.test", "same-site"],
    [null, "same-site"],
    [null, "none"],
  ] as const) {
    const response = await signOutFrom(origin, fetchSite);
    expect(response.status, `${origin} ${fetchSite}`).toBe(403);
    expect(response.headers.has("clear-site-data")).toBe(false);
    expect(response.headers.getSetCookie()).toEqual([]);
  }
  expect(asked).toEqual([]);
});

test("the cookie that caches the session is expired with the session cookie", async () => {
  answer = () => {
    const response = expiring(200, "{}");
    response.headers.append(
      "set-cookie",
      "__Secure-sermo.session_data=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax",
    );
    return response;
  };
  await signOutFrom("https://forum.example.test");
  expect(cookieSets).toContainEqual({
    name: "__Secure-sermo.session_data",
    value: "",
    maxAge: 0,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
  });
});

test("signing out marks the browser for one clean-up of its storage, which the next page makes", async () => {
  const response = await signOutFrom("https://forum.example.test");
  const cookie = response.headers
    .getSetCookie()
    .find((line) => line.startsWith(`${SIGNED_OUT_COOKIE}=`));
  expect(cookie).toContain(`${SIGNED_OUT_COOKIE}=1;`);
  expect(cookie).toContain("Path=/");
  expect(cookie).toContain("Max-Age=300");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("SameSite=lax");
  // The page script reads it.
  expect(cookie).not.toContain("HttpOnly");
});

test("a sign-out the backend could not make does not mark the browser for a clean-up", async () => {
  answer = () => new Response("", { status: 503 });
  const response = await signOutFrom("https://forum.example.test");
  expect(
    response.headers
      .getSetCookie()
      .some((line) => line.startsWith(`${SIGNED_OUT_COOKIE}=`)),
  ).toBe(false);
});
