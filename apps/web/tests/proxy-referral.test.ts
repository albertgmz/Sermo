import { expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

// The backend is not involved in a referral: the pages asked for here (the home page, the forum
// list, the register page) need no record, and the site's default language is faked.
mock.module("@/lib/sermo/default-language", () => ({
  siteDefaultLanguage: async () => "en",
  forgetDefaultLanguage: () => {},
}));
mock.module("server-only", () => ({}));
mock.module("@/lib/sermo/viewer", () => ({ viewerOf: async () => null }));

// A private copy of the module: another suite may have loaded the proxy against its own mocks.
const source = "../src/proxy.ts?referral";
const { proxy } = (await import(source)) as typeof import("../src/proxy");

const consentTo = (...categories: string[]) =>
  `forum_consent=${encodeURIComponent(
    JSON.stringify({ categories: ["necessary", ...categories], revision: 1 }),
  )}`;
const ACCEPTED = consentTo("referrals");

// A page load, as a browser makes it; `fetch` is what a link followed inside the app makes.
function ask(
  path: string,
  cookie = "",
  headers: Record<string, string> = { "sec-fetch-mode": "navigate" },
) {
  return proxy(
    new NextRequest(`http://localhost${path}`, {
      headers: { ...headers, ...(cookie ? { cookie } : {}) },
    }),
  );
}

const referralCookie = (response: Response | undefined) =>
  response?.headers
    .getSetCookie()
    .find((header) => header.startsWith("forum_ref="));

test("the cookie is set once the visitor accepted referrals: HttpOnly, Lax, thirty days", async () => {
  const response = await ask("/?ref=12", ACCEPTED);
  const cookie = referralCookie(response);
  expect(cookie).toBeDefined();
  expect(cookie).toContain("forum_ref=12");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=lax");
  expect(cookie).toContain("Path=/");
  expect(cookie).toContain(`Max-Age=${60 * 60 * 24 * 30}`);
  // The page is still served.
  expect(response?.headers.get("x-middleware-rewrite")).toBe(
    "http://localhost/en?ref=12",
  );
});

test("the cookie is Secure when the site is served over https", async () => {
  const before = process.env.SERMO_PUBLIC_URL;
  process.env.SERMO_PUBLIC_URL = "https://forum.example.test";
  try {
    expect(referralCookie(await ask("/?ref=12", ACCEPTED))).toContain("Secure");
  } finally {
    if (before === undefined) delete process.env.SERMO_PUBLIC_URL;
    else process.env.SERMO_PUBLIC_URL = before;
  }
});

test("without the visitor's consent there is no cookie", async () => {
  for (const cookie of [
    "",
    consentTo(),
    consentTo("analytics", "embeds"),
    // A choice made for another policy version is no choice.
    `forum_consent=${encodeURIComponent(
      JSON.stringify({ categories: ["necessary", "referrals"], revision: 2 }),
    )}`,
    "forum_consent=garbage",
  ]) {
    const response = await ask("/?ref=12", cookie);
    expect(referralCookie(response), cookie).toBeUndefined();
  }
});

test("the first referrer wins: a cookie already holding one is left alone", async () => {
  const response = await ask("/?ref=12", `${ACCEPTED}; forum_ref=7`);
  expect(referralCookie(response)).toBeUndefined();
});

test("a cookie that holds no member id is replaced", async () => {
  const response = await ask("/?ref=12", `${ACCEPTED}; forum_ref=junk`);
  expect(referralCookie(response)).toContain("forum_ref=12");
});

test("a ref that is not a positive whole number is ignored", async () => {
  for (const ref of [
    "",
    "0",
    "-3",
    "1.5",
    "abc",
    "1e2",
    "0x10",
    "%207",
    "007",
  ]) {
    const response = await ask(`/?ref=${ref}`, ACCEPTED);
    expect(referralCookie(response), ref).toBeUndefined();
  }
  // The first of several is the one read.
  expect(referralCookie(await ask("/?ref=x&ref=3", ACCEPTED))).toBeUndefined();
  expect(referralCookie(await ask("/?ref=3&ref=x", ACCEPTED))).toContain(
    "forum_ref=3",
  );
});

test("only a page load sets it, not the fetch behind a link or an action", async () => {
  const link = await ask("/?ref=12", ACCEPTED, { "sec-fetch-mode": "cors" });
  expect(referralCookie(link)).toBeUndefined();
  const action = await proxy(
    new NextRequest("http://localhost/?ref=12", {
      method: "POST",
      headers: { cookie: ACCEPTED, "next-action": "abc" },
    }),
  );
  expect(referralCookie(action)).toBeUndefined();
});

test("any page can carry it, the register page and a redirect included", async () => {
  expect(referralCookie(await ask("/register?ref=5", ACCEPTED))).toContain(
    "forum_ref=5",
  );
  expect(referralCookie(await ask("/forums?ref=5", ACCEPTED))).toContain(
    "forum_ref=5",
  );
  // The language segment is not an address: it redirects, and the redirect keeps the cookie.
  const redirect = await ask("/es/forums?ref=5", ACCEPTED);
  expect(redirect?.status).toBe(307);
  expect(referralCookie(redirect)).toContain("forum_ref=5");
});

test("the API and Next's own files are left alone", async () => {
  expect(await ask("/api/v1/me?ref=5", ACCEPTED)).toBeUndefined();
  expect(await ask("/_next/static/a.js?ref=5", ACCEPTED)).toBeUndefined();
});

test("a cookie the visitor no longer accepts is removed", async () => {
  for (const consent of ["", consentTo(), consentTo("analytics")]) {
    const response = await ask(
      "/",
      `${consent}; forum_ref=7`.replace(/^; /, ""),
    );
    const cookie = referralCookie(response);
    expect(cookie, consent).toContain("forum_ref=;");
    expect(cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  }
  // While it is accepted it stays, and a request without it sets nothing.
  expect(await ask("/", `${ACCEPTED}; forum_ref=7`)).toSatisfy(
    (response: Response | undefined) => referralCookie(response) === undefined,
  );
  expect(referralCookie(await ask("/", ACCEPTED))).toBeUndefined();
});

test("a page reached through ?ref= names itself without it as the canonical address", async () => {
  const before = process.env.SERMO_PUBLIC_URL;
  process.env.SERMO_PUBLIC_URL = "https://forum.example.test";
  try {
    const link = (response: Response | undefined) =>
      response?.headers.get("link");
    expect(link(await ask("/forums?ref=9"))).toBe(
      '<https://forum.example.test/forums>; rel="canonical"',
    );
    // Other parameters stay, and so does the consent state: it makes no difference here.
    expect(link(await ask("/forums?page=2&ref=9&x=a%20b", ACCEPTED))).toBe(
      '<https://forum.example.test/forums?page=2&x=a+b>; rel="canonical"',
    );
    // An invalid ref still points to the plain address.
    expect(link(await ask("/forums?ref=abc"))).toBe(
      '<https://forum.example.test/forums>; rel="canonical"',
    );
    // A page without ref, a link followed inside the app and a redirect carry none.
    expect(link(await ask("/forums"))).toBeNull();
    expect(
      link(await ask("/forums?ref=9", "", { "sec-fetch-mode": "cors" })),
    ).toBeNull();
    expect(link(await ask("/es/forums?ref=9"))).toBeNull();
  } finally {
    if (before === undefined) delete process.env.SERMO_PUBLIC_URL;
    else process.env.SERMO_PUBLIC_URL = before;
  }
});
